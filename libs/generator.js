'use strict';

// Requires
const debug = require('debug')('generator')
const {
  initializeDatabase,
  getBucketData,
  getDnsChildData,
} = require('./firebase.js')
var request = require('request');
var mkdirp = require('mkdirp');
var path = require('path');
var fs = require('fs');
const fsp = require('fs/promises')
const fse = require('fs-extra')
var glob = require('glob');
var tinylr = require('tiny-lr');
var _ = require('lodash');
var utils = require('./utils.js');
var websocketServer = require('nodejs-websocket');
var Zip   = require('adm-zip');
var slug = require('uslug');
var async = require('async');
var miss = require('mississippi');
var touch = require('touch')
var spawn = require('win-spawn');
var md5 = require('MD5');
var $ = require('cheerio');
var exec = require('child_process').exec;

require('colors');

// Template requires
var swig = require('@risd/swig');
swig.setDefaults({ loader: swig.loaders.fs(__dirname + '/..') });
var swigFunctions = require('./swig_functions').swigFunctions();
var swigFilters = require('./swig_filters');
var swigTags = require('./swig_tags');
swigFilters.init(swig);
swigTags.init(swig);
swig.setDefaults({ cache: false });

var default_generator_url = 'http://dump.webhook.com/static/generate-repo.zip';

var wrap = function()
{
  var args = Array.prototype.slice.call(arguments);

  var last = args.pop();
  last = 'debugger;' +
         'var global = null;' +
         'var console = null;' +
         'var v8debug = null;' +
         'var setTimeout = null;' +
         'var setInterval = null;' +
         'var setImmediate = null;' +
         'var clearTimeout = null;' +
         'var clearInterval = null;' +
         'var clearImmediate = null;' +
         'var root = null;' +
         'var GLOBAL = null;' +
         'var window = null;' +
         'var process = null;' +
         'var eval = null;' +
         'var require = null;' +
         'var __filename = null;' +
         'var __dirname = null;' +
         'var modules = null;' +
         'var exports = null;' +
         last;

  args.push(last);

  return Function.prototype.constructor.apply(this, args);
};
wrap.prototype = Function.prototype;
Function = wrap;

// Disable console log in various things
//console.log = function () {};

var cmsSocketPort = 6557;
var BUILD_DIRECTORY = '.build';
var DATA_CACHE_PATH = path.join( BUILD_DIRECTORY, 'data.json' )
let templateExtensions = [
  '.html',
  '.swig',
  '.xml',
  '.rss',
  '.xhtml',
  '.atom',
  '.txt',
  '.json',
  '.svg',
  '.html-partial',
]

// listened to by the webhook/push command
// to determine if the deploy should halt.
var BUILD_STRICT_ERROR = function ( file ) {
  return `build-strict:error:${ file }`
}

// listened to by the webhook-server-open/builder
// to be notified of when the current file has produced all its files
var BUILD_TEMPLATE_START = function ( file ) {
  return `build-template:start:${ file }`
}

var BUILD_TEMPLATE_END = function ( file ) {
  return `build-template:end:${ file }`
}


var BUILD_PAGE_START = function ( file ) {
  return `build-page:start:${ file }`
}

var BUILD_PAGE_END = function ( file ) {
  return `build-page:end:${ file }`
}

// listened to by the webhook-server-open/builder
// to be notified of written documents to upload.
var BUILD_DOCUMENT_WRITTEN = function ( file ) {
  return `build:document-written:${ file }`
}

const pglob = (pattern, options) => {
  return new Promise((resolve, reject) => {
    glob(pattern, options, (error, matches) => {
      if (error) return reject(error)
      resolve(matches)
    })
  })
}

const isDirectory = async (filePath) => {
  return new Promise((resolve, reject) => {
    fs.lstat(filePath, (error, stats) => {
      if (error) return reject(error)
      resolve(stats.isDirectory())
    })
  })
}

const fileExists = async (filePath) => {
  if (!filePath) return Promise.resolve(false)
  return new Promise((resolve, reject) => {
    fs.access(filePath, fs.constants.F_OK, (error) => {
      resolve(error ? false : true)
    })
  })
}

const readFile = async (filePath) => {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (error, content) => {
      if (error) return reject(error)
      resolve(content.toString())
    })
  })
}

const writeFile = async (filePath, content) => {
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, content, (error) => {
      if (error) return reject(error)
      resolve()
    })
  })
}

/**
 * Generator that handles various commands
 * @param  {Object}  config  grunt.config object
 * @param  {Object}  config.webhook key:value from .firebase.conf
 * @param  {string}  config.webhook.siteKey
 * @param  {string}  config.webhook.siteName
 * @param  {string}  config.webhook.firebase
 * @param  {string}  config.webhook.firebaseAPIKey
 * @param  {string}  config.webhook.embedly
 * @param  {string}  config.webhook.server
 * @param  {string}  config.webhook.imgix_host
 * @param  {string}  config.webhook.imgix_secret
 * @param  {string}  config.webhook.generator_url
 * @param  {boolean}  config.webhook.custom
 * @param  {object}  config.connect
 * @param  {object}  config.connect.wh-server
 * @param  {object}  config.connect.wh-server.options
 * @param  {number}  config.connect.wh-server.options.liverload
 * @param  {Object} config.swig
 * @param  {Object} config.swig.functions
 * @param  {Object} config.swig.filters
 * @param  {Object} config.swig.tags
 * @param  {Object} options
 * @param  {boolean} options.npmCache
 * @param  {string} options.npm  path to npm command path to use
 * @param  {Object}  logger  Object to use for logging, defaults to no-ops
 * @param  {Object}  fileParse  grunt.file instance
 */
module.exports.generator = function (config, options, logger, fileParser) {
  var self = this;
  var firebaseName = config.get('webhook').firebase;
  var firebaseAPIKey = config.get('webhook').firebaseAPIKey;
  var liveReloadPort = config.get('connect')['wh-server'].options.livereload;

  if(liveReloadPort !== 35730) {
    cmsSocketPort = liveReloadPort + 1;
  }

  var websocket = null;
  var strictMode = false;
  var productionFlag = false;

  this.versionString = null;
  this.cachedData = null;
  this._settings = {};

  if(liveReloadPort === true)
  {
    liveReloadPort = 35729;
  }

  logger = logger || { ok: function() {}, error: function() {}, write: function() {}, writeln: function() {} };

  // We dont error out here so init can still be run
  if (firebaseName && firebaseAPIKey)
  {
    this.root = initializeDatabase({
      apiKey: firebaseAPIKey,
      authDomain: `${ firebaseName }.firebaseapp.com`,
      databaseURL: `${ firebaseName }.firebaseio.com`,
    })
  } else {
    this.root = null;
  }

  var userSwigConfig = config.get('swig');
  if ( userSwigConfig ) {
    // functions
    if ( userSwigConfig.functions ) {
      swigFunctions.userFunctions( userSwigConfig.functions )
    }
    // filters
    if ( userSwigConfig.filters ) {
      swigFilters.userFilters( userSwigConfig.filters )
    }
    // tags
    if ( userSwigConfig.tags ) {
      swigTags.userTags( userSwigConfig.tags )
    }
  }

  const userTemplateExtensions = config.get('templateExtensions')
  if (userTemplateExtensions) {
    templateExtensions = templateExtensions.concat(userTemplateExtensions)
  }

  var getTypeData = function(type, callback) {
    getBucket().child('contentType').child(type).once('value', function(data) {
      callback(data.val());
    });
  }

  /**
   * Retrieves snapshot of data from Firebase
   * @param  {Function}   callback   Callback function to run after data is retrieved, is sent the snapshot
   */
  var getData = async function(callback) {
    debug('get-data')
    if(self.cachedData)
    {
      Object.assign(self.cachedData.settings.general, self._settings)
      if (self.cachedData.hasOwnProperty('contentType'))
        self.cachedData.typeInfo = self.cachedData.contentType
      swigFunctions.setData(self.cachedData.data);
      swigFunctions.setTypeInfo(self.cachedData.typeInfo);
      swigFunctions.setSettings(self.cachedData.settings);
      swigFilters.setSiteDns(self.cachedData.siteDns);
      swigFilters.setFirebaseConf(config.get('webhook'));
      swigFilters.setTypeInfo(self.cachedData.typeInfo);
      if (self._settings.site_url) swigFilters.setSiteDns(self._settings.site_url);

      const returnValue = {
        data: self.cachedData.data,
        typeInfo: self.cachedData.typeInfo
      }

      if (callback) callback(returnValue)

      return Promise.resolve(returnValue)
    }

    if(!self.root)
    {
      throw new Error('Missing firebase reference, may need to run init');
    }

    try {
      let data = await getBucketData({
        siteName: config.get('webhook').siteName,
        siteKey: config.get('webhook').siteKey,
      })

      var typeInfo = {};
      var settings = {};

      if(!data || !data['contentType'])
      {
        typeInfo = {};
      } else {
        typeInfo = data['contentType'];
      }

      if(!data || !data.settings) {
        settings = { general: {} };
      } else {
        settings = data.settings;
        if ( ! settings.general ) settings.general = {};
      }
      Object.assign(settings.general, self._settings)

      // Get the data portion of bucket, other things are not needed for templates
      if(!data || !data.data) {
        data = {};
      } else {
        data = data.data;
      }

      self.cachedData = {
        data: data,
        typeInfo: typeInfo,
        settings: settings
      };

      // Sets the context for swig functions
      swigFunctions.setData(data);
      swigFunctions.setTypeInfo(typeInfo);
      swigFunctions.setSettings(settings);
      swigFilters.setTypeInfo(typeInfo);

      let siteDns = await getDnsChildData({ siteName: config.get('webhook').siteName })
      if (!siteDns) config.get('webhook').siteName + '.webhook.org'

      self.cachedData.siteDns = siteDns;
      swigFilters.setSiteDns(siteDns);
      if (self._settings.site_url) {
        self.cachedData.siteDns = self._settings.site_url;
        swigFilters.setSiteDns(self._settings.site_url);
      }
      swigFilters.setFirebaseConf(config.get('webhook'));

      const returnValue = { data, typeInfo }

      if (callback) callback(returnValue)

      return Promise.resolve(returnValue)
    } catch (error) {
      if(error.code === 'PERMISSION_DENIED') {
        console.log('\n========================================================'.red);
        console.log('# Permission denied                                         #'.red);
        console.log('========================================================'.red);
        console.log('#'.red + ' You don\'t have permission to this site or your subscription expired.'.red);
        console.log('# Visit '.red + 'https://billing.webhook.com/site/'.yellow + config.get('webhook').siteName.yellow + '/'.yellow  + ' to manage your subscription.'.red);
        console.log('# ---------------------------------------------------- #'.red)
        process.exit(1);
      } else {
        throw new Error(error);
      }
    }
  };

  /**
   * downloadData function to download data to a file path for files
   * to continually use as they are built between processes.
   * Defaults saving to DATA_CACHE_PATH
   *
   * @param  {object}   options
   * @param  {object}   options.file?     Specificy which file to write to. Optional.
   * @param  {object}   options.emitter?  Specificy whether to emit progress to process.stout
   */
  this.downloadData = async function ( options ) {
    if ( !options ) options = {};
    if ( !options.file ) options.file = DATA_CACHE_PATH;


    const { data } = await getData()
    await writeDataCache( { file: options.file, data: self.cachedData } )
  }

  var searchEntryStream = null;

  this.openSearchEntryStream = function(callback) {
    if(config.get('webhook').noSearch === true) {
      callback();
      return;
    }

    if(!fs.existsSync('./.build/.wh/')) {
      mkdirp.sync('./.build/.wh/');
    }

    searchEntryStream = fs.createWriteStream('./.build/.wh/searchjson.js');

    searchEntryStream.write('var tipuesearch = {"pages": [\n');

    callback();
  };


  this.closeSearchEntryStream = function(callback) {
    if(config.get('webhook').noSearch === true || !searchEntryStream) {
      callback();
      return;
    }

    searchEntryStream.end(']}');

    searchEntryStream.on('close', function() {
      callback();
    });
  };

  var writeSearchEntry = function(outFile, output) {
    if(config.get('webhook').noSearch === true || !searchEntryStream) {
      return;
    }

    var endUrl = outFile.replace('./.build', '');

    if(path.extname(endUrl) !== '.html' || endUrl === '/404.html' || endUrl.indexOf('/_wh_previews') === 0) {
      return;
    }

    endUrl = endUrl.replace('index.html', '');

    var content = $.load(output);

    var title = content('title').text();
    var bodyObj = content('body');

    if(bodyObj.attr('data-search-index') === "false") {
      return;
    }

    var specialChild = bodyObj.find('[data-search-index="true"]');

    if(specialChild.length > 0) {
      bodyObj = specialChild.first();
    }

    bodyObj.find('script').remove();
    bodyObj.find('iframe').remove();
    bodyObj.find('object').remove();
    bodyObj.find('[data-search-index="false"]').remove();

    var body = bodyObj.text().trim();
    var tags = "";

    if(content('meta[name="keywords"]').length > 0) {
      tags = content('meta[name="keywords"]').attr('content');
    }

    if(searchEntryStream) {
      var searchObj = {
        title: title,
        text: body,
        tags: tags,
        loc: endUrl
      };

      searchEntryStream.write(JSON.stringify(searchObj) + ',\n');

      searchObj = null;
    }

    title = '';
    body = '';
  };

  /**
   * Build Order
   * Creates a `.build-order` directory if it does not exists.
   * Sets the `default` build order, and opens an `ordered`.
   * These are used by the server to determine the order in which
   * templates are built and uploaded.
   *
   * @param  {Function} callback Callback is executed with an array of the files
   */
  this.buildOrder = async function () {
    const folder = path.join(process.cwd(), '.build-order')
    
    var excludeExtensions = filterExtensions([ '' ])
    const allTemplateFiles = await pglob('templates/**/*', { nodir: true })
    const templateFiles = allTemplateFiles
      .filter(removePartials)
      .filter(excludeExtensions)
      .sort()
    const allPageFiles = await pglob('pages/**/*', { nodir: true })
    const pagesFiles = allPageFiles
      .filter(excludeExtensions)
      .sort()

    const filesString = templateFiles.concat(pagesFiles).join('\n')
    const filePath = path.join(folder, 'default')

    await fsp.writeFile(filePath, filesString)
    return { filePath }

    function removePartials ( file ) {
      return file.indexOf( 'partials' ) === -1;
    }
    function filterExtensions ( extensions ) {
      return function filterer ( file ) {
        return extensions.filter( function ( extension ) { return path.extname( file ) === extension } ).length === 0;
      }
    }
  }

  /**
   * writeDocument.
   * Optionally log out to process.stdout that the file has been written.
   * @param  {object}    options
   * @param  {string}    options.file     The file path to write to
   * @param  {string}    options.content  The content to write to the file
   * @param  {boolean}   options.emitter  If true, log out that the document has been written
   * @return {undefined}
   */
  var writeDocument = async function ( options ) {
    // todo: make this async
    if ( !options ) options = {}
    return new Promise((resolve, reject) => {
      fs.writeFile( options.file, options.content, (error) => {
        if (error) return reject(error)
        if ( options.emitter ) console.log( BUILD_DOCUMENT_WRITTEN( options.file ) )
        if (typeof process.send === 'function') process.send(BUILD_DOCUMENT_WRITTEN( options.file ))
        resolve()
      })
    })
  }

  var doNoPublishPageTemplate = swig.renderFile( './libs/do-not-publish-page.html' ).trim()
  var doNotPublishPage = function ( template ) {
    return ( template.indexOf( doNoPublishPageTemplate ) !== -1 )
      ? true
      : false;
  }

  /**
   * Writes an instance of a template to the build directory
   *
   * @param  {string}   inFile          Template to read
   * @param  {string}   outFile         Destination in build directory
   * @param  {Object}   params          The parameters to pass to the template
   * @param  {Object}   params.item     The item data object to pass into the rendering function.
   * @param  {boolean}  params.emitter  If true, when writing the template, write the path to stdout.
   *                                    Useful for other processes looking for when files are written.
   */
  var writeTemplate = async function(inFile, outFile, params) {
    // todo: make this async
    params = params || {};
    params['firebase_conf'] = config.get('webhook');
    var originalOutFile = outFile;

    // Merge functions in
    params = utils.extend(params, swigFunctions.getFunctions());

    params.cmsSocketPort = cmsSocketPort;

    swigFunctions.init();

    var outputUrl = outFile.replace('index.html', '').replace('./.build', '');
    swigFunctions.setParams({ CURRENT_URL: outputUrl });

    if(params.item) {
      params.item = params._realGetItem(params.item._type, params.item._id, true);
    }

    params.production = productionFlag;

    var output = '';
    try {
      output = swig.renderFile(inFile, params);
    } catch (e) {
      self.sendSockMessage(e.toString());

      if(strictMode) {
        console.log( BUILD_STRICT_ERROR( inFile ) )
        throw e;
      } else {
        console.log('Error while rendering template: ' + inFile);
        console.log(e.toString().red);
        try {
          output = swig.renderFile('./libs/debug500.html', { template: inFile, error: e.toString(), backtrace: e.stack.toString() })
        } catch (e) {
          return '';
        }
      }
    }

    if ( doNotPublishPage( output ) ) return;

    await mkdirp(path.dirname(outFile))
    await writeDocument( { file: outFile, content: output, emitter: params.emitter } );
    writeSearchEntry(outFile, output);

    // Haha this crazy nonsense is to handle pagination, the swig function "paginate" makes
    // shouldPaginate return true if there are more pages left, so we enter a while loop to
    // generate each page of the pagination (todo one day, abstract this with above code into simple functions)
    swigFunctions.increasePage();
    while(swigFunctions.shouldPaginate())
    {
      outFile = originalOutFile.replace('/index.html', '/' + swigFunctions.pageUrl + swigFunctions.curPage + '/index.html');
      outputUrl = outFile.replace('index.html', '').replace('./.build', '');

      swigFunctions.setParams({ CURRENT_URL: outputUrl });

      try {
        var output = swig.renderFile(inFile, params);
      } catch (e) {
        self.sendSockMessage(e.toString());

        if(strictMode) {
          throw e;
        } else {
          console.log('Error while rendering template: ' + inFile);
          console.log(e.toString().red);
          try {
            output = swig.renderFile('./libs/debug500.html', { template: inFile, error: e.toString(), backtrace: e.stack.toString() })
          } catch (e) {
            return '';
          }
        }
      }

      await mkdirp(path.dirname(outFile))
      await writeDocument( { file: outFile, content: output, emitter: params.emitter } )
      writeSearchEntry(outFile, output);

      swigFunctions.increasePage();
    }

    return Promise.resolve(outFile.replace('./.build', ''))
  };

  /**
   * Downloads a zip file from the requested url and extracts it into the main directory
   * @param  {string}   zipUrl     Url to zip file to download
   * @param  {Function}   callback   Callback, first parameter is error (true if error occured);
   */
  var downloadRepo = function(zipUrl, callback) {
    logger.ok('Downloading preset...');

    // Keep track if the request fails to prevent the continuation of the install
    var requestFailed = false;

    // TODO: have this hit different templating repos
    var repoRequest = request(zipUrl);

    repoRequest
    .on('response', function (response) {
      // If we fail, set it as failing and remove zip file
      if (response.statusCode !== 200) {
        requestFailed = true;
        fs.unlinkSync('.preset.zip');
        callback(true);
      }
    })
    .pipe(fs.createWriteStream('.preset.zip'))
    .on('close', function () {
      if (requestFailed) return;

      // Unzip into temporary file
      var zip = new Zip('.preset.zip');

      var entries = zip.getEntries();

      if(fs.existsSync('package.json')) {
        fs.renameSync('package.json', 'old.package.json');
      }

      entries.forEach(function(entry) {
        var newName = entry.entryName.split('/').slice(1).join('/');
        entry.entryName = newName;
      });
      zip.extractAllTo('.', true);

      if(fs.existsSync('old.package.json') && fs.existsSync('package.json')) {
        var packageJson = JSON.parse(fs.readFileSync('package.json'));
        var oldPackageJson = JSON.parse(fs.readFileSync('old.package.json'));

        var depends = packageJson.dependencies;
        var oldDepends = oldPackageJson.dependencies;

        _.assign(depends, oldDepends);

        packageJson.dependencies = depends;

        fs.writeFileSync('package.json', JSON.stringify(packageJson, null, "  "));
        fs.unlinkSync('old.package.json');
      } else if(fs.existsSync('old.package.json')) {
        fs.renameSync('old.package.json', 'package.json');
      }

      fs.unlinkSync('.preset.zip');
      callback();
    });
  };


  var resetGenerator = function(callback) {
    logger.ok('Resetting Generator...');
    var zipUrl = config.get('webhook').generator_url || default_generator_url;

    // Keep track if the request fails to prevent the continuation of the install
    var requestFailed = false;

    // TODO: have this hit different templating repos
    var repoRequest = request(zipUrl);

    repoRequest
    .on('response', function (response) {
      // If we fail, set it as failing and remove zip file
      if (response.statusCode !== 200) {
        requestFailed = true;
        fs.unlinkSync('.reset.zip');
        callback(true);
      }
    })
    .pipe(fs.createWriteStream('.reset.zip'))
    .on('close', function () {
      if (requestFailed) return;

      // Unzip into temporary file
      var zip = new Zip('.reset.zip');

      var entries = zip.getEntries();

      removeDirectory('.pages-old', function() {
        removeDirectory('.templates-old', function() {
          removeDirectory('.static-old', function() {

            try {
              fs.renameSync('pages', '.pages-old');
            } catch(error) {
              fs.unlinkSync('.reset.zip');
              callback(true);
              return;
            }

            try {
              fs.renameSync('templates', '.templates-old');
            } catch(error) {
              fs.renameSync('.pages-old', 'pages');
              fs.unlinkSync('.reset.zip');
              callback(true);
              return;
            }

            try {
              fs.renameSync('static', '.static-old');
            } catch(error) {
              fs.renameSync('.pages-old', 'pages');
              fs.renameSync('.templates-old', 'templates');
              fs.unlinkSync('.reset.zip');
              callback(true);
              return;
            }

            entries.forEach(function(entry) {
              if(entry.entryName.indexOf('pages/') === 0
                 || entry.entryName.indexOf('templates/') === 0
                 || entry.entryName.indexOf('static/') === 0) {
                zip.extractEntryTo(entry.entryName, '.', true, true);
              }
            });

            removeDirectory('.pages-old', function() {
              removeDirectory('.templates-old', function() {
                removeDirectory('.static-old', function() {
                  fs.unlinkSync('.reset.zip');

                  self.init(config.get('webhook').siteName,
                    config.get('webhook').siteKey,
                    true,
                    config.get('webhook').firebase,
                    config.get('webhook').server,
                    config.get('webhook').embedly,
                    config.get('webhook').imgix_host,
                    config.get('webhook').imgix_secret,
                    config.get('webhook').generator_url,
                    function () {
                      callback();
                    }
                  );
                });
              });
            });

          });
        });
      });
    });
  };

  /**
  * Extracts a local theme zip into the current generator directory
  * @param zipUrl   The location of the zip file on disk
  * @param callback The callback to call with the data from the theme
  */
  var extractPresetLocal = function(fileData, callback) {

    fs.writeFileSync('.preset.zip', fileData, { encoding: 'base64' });
    // Unzip into temporary file
    var zip = new Zip('.preset.zip');

    var entries = zip.getEntries();

    if(fs.existsSync('package.json')) {
      fs.renameSync('package.json', 'old.package.json');
    }

    entries.forEach(function(entry) {
      var newName = entry.entryName.split('/').slice(1).join('/');
      entry.entryName = newName;
    });
    zip.extractAllTo('.', true);

    if(fs.existsSync('old.package.json') && fs.existsSync('package.json')) {
      var packageJson = JSON.parse(fs.readFileSync('package.json'));
      var oldPackageJson = JSON.parse(fs.readFileSync('old.package.json'));

      var depends = packageJson.dependencies;
      var oldDepends = oldPackageJson.dependencies;

      _.assign(depends, oldDepends);

      packageJson.dependencies = depends;

      fs.writeFileSync('package.json', JSON.stringify(packageJson, null, "  "));
      fs.unlinkSync('old.package.json');
    } else if(fs.existsSync('old.package.json')) {
      fs.renameSync('old.package.json', 'package.json');
    }

    fs.unlinkSync('.preset.zip');

    if(fs.existsSync('.preset-data.json')) {
      var presetData = fileParser.readJSON('.preset-data.json');

      fs.unlinkSync('.preset-data.json');
      logger.ok('Done extracting.');
      callback(presetData);

    } else {
      logger.ok('Done extracting.');
      callback(null);
    }
  }

  /**
   * Downloads zip file and then sends the preset data for the theme to the CMS for installation
   * @param  {string}   zipUrl     Url to zip file to download
   * @param  {Function}   callback   Callback, first parameter is preset data to send to CMS
   */
  var downloadPreset = function(zipUrl, callback) {
    downloadRepo(zipUrl, function() {
      if(fs.existsSync('.preset-data.json')) {
        var presetData = fileParser.readJSON('.preset-data.json');

        fs.unlinkSync('.preset-data.json');
        logger.ok('Done downloading.');
        callback(presetData);

      } else {
        logger.ok('Done downloading.');
        callback(null);
      }
    });
  };

  /**
   * Renders all templates in the /pages directory to the build directory
   * @param  {object}   opts
   * @param  {number}   opts.concurrency?  Number of CPUs to use when building templats.
   * @param  {string}   opts.pages?        The page filtering string to use.
   * @param  {string}   opts.data?         Data object to use. If not supplied, `getData` is run.
   * @param  {boolean}  opts.emitter?      Boolean to determine if the build process should emit events of progress to process.stdin
   *                                       If true, other processes can operate on the partially built site.
   * @param  {Function}   done     Callback passed either a true value to indicate its done, or an error
   * @param  {Function}   cb       Callback called after finished, passed list of files changed and done function
   */
  this.renderPages = async function (opts, done, cb)  {
    logger.ok('Rendering Pages\n');

    var queryFiles = opts.pages || 'pages/**/*'

    if ( opts.data ) setDataFrom( opts.data )

    const { data } = await getData()
    const files = await pglob(queryFiles, { nodir: true })

    const writers = files.map(async function(file) {
      if(await isDirectory(file)) {
        return Promise.resolve(null)
      }

      var newFile = file.replace('pages', './.build');

      var dir = path.dirname(newFile);
      var filename = path.basename(newFile, path.extname(file));
      var extension = path.extname(file);

      if(path.extname(file) === '.html' && filename !== 'index' && path.basename(newFile) !== '404.html' && file.indexOf('.raw.html') === -1) {
        dir = dir + '/' + filename;
        filename = 'index';
      }

      if(filename.indexOf('.raw') !== -1 && filename.indexOf('.raw') === (filename.length - 4) && extension === '.html') {
        filename = filename.slice(0, filename.length - 4);
      }

      newFile = dir + '/' + filename + path.extname(file);

      if (templateExtensions.indexOf(extension) !== -1) {
        await writeTemplate(file, newFile, { emitter: opts.emitter });
      } else {
        await mkdirp(path.dirname(newFile))
        // fs.writeFileSync(newFile, fs.readFileSync(file));
        await writeDocument( {
          file: newFile,
          content: fs.readFileSync(file),
          emitter: opts.emitter,
        } );
      }

      return Promise.resolve({ file, built: true })
    })

    await Promise.all(writers)


    if(await fileExists('./libs/.supported.js')) {
      await mkdirp('./.build/.wh/_supported')

      await writeDocument( {
        file: './.build/.wh/_supported/index.html',
        content: fs.readFileSync('./libs/.supported.js'),
        emitter: opts.emitter,
      } );
    }

    logger.ok('Finished Rendering Pages\n');

    if(cb) cb(done);
    else if (done) done()

    return Promise.resolve()
  };

  var generatedSlugs = {};
  var generateSlug = function(value) {
    if(!generatedSlugs[value._type]) {
      generatedSlugs[value._type] = {};
    }

    if(value.slug) {
      generatedSlugs[value._type][value.slug] = true;
      return value.slug;
    }
    var tmpSlug = slug(value.name).toLowerCase();

    var no = 2;
    while(generatedSlugs[value._type][tmpSlug]) {
      tmpSlug = slug(value.name).toLowerCase() + '_' + no;
      no++;
    }

    generatedSlugs[value._type][tmpSlug] = true;

    return tmpSlug;
  }


  /**
   * Render a single template file.
   * @param  {object}   opts
   * @param  {string}   opts.inFile      The template file to build
   * @param  {string|object}  opts.data?      The data to use
   * @param  {string|object}  opts.settings?  The settings to use
   * @param  {boolean}  opts.emitter?  Boolean to determine if the build process should emit events of progress to process.stdin
   *                                   If true, other processes can operate on the partially built site.
   * @param  {Function} done           callback
   */
  this.renderTemplate = async function (opts, done) {

    setSettingsFrom( opts.settings )
    setDataFrom( opts.data )

    const { data, typeInfo } = await getData()

    if ( opts.emitter ) console.log(  BUILD_TEMPLATE_START( opts.inFile ) )
    await processFile( opts.inFile );
    if ( opts.emitter ) console.log( BUILD_TEMPLATE_END( opts.inFile ) )
    if (done) done();
    return Promise.resolve()

    async function processFile ( file ) {
      debug('render-template:process-file')
      // Here we try and abstract out the content type name from directory structure
      var baseName = path.basename(file, '.html');
      var newPath = path.dirname(file).replace('templates', './.build').split('/').slice(0,3).join('/');

      var pathParts = path.dirname(file).split('/');
      var objectName = pathParts[1];
      var items = data[objectName];
      var info = typeInfo[objectName];
      var filePath = path.dirname(file);
      var overrideFile = null;

      if(!items) {
        logger.error('Missing data for content type ' + objectName);
      }

      items = _.map(items, function(value, key) { value._id = key; value._type = objectName; return value });

      var build_preview = true;
      if ( opts.itemKey ) {
        build_preview = true;
        items = items.filter( function ( item ) { return item._id === opts.itemKey } )
      }

      var publishedItems = _.filter(items, function(item) {
        if(!item.publish_date) {
          return false;
        }

        var now = Date.now();
        var pdate = Date.parse(item.publish_date);

        if(pdate > now + (1 * 60 * 1000)) {
          return false;
        }

        return true;
      });

      var baseNewPath = '';

      // Find if this thing has a template control
      var templateWidgetName = null;

      if(typeInfo[objectName]) {
        typeInfo[objectName].controls.forEach(function(control) {
          if(control.controlType === 'layout') {
            templateWidgetName = control.name;
          }
        });
      }

      var listPath = null;

      if(typeInfo[objectName] && typeInfo[objectName].customUrls && typeInfo[objectName].customUrls.listUrl) {
        var customPathParts = newPath.split('/');

        if(typeInfo[objectName].customUrls.listUrl === '#') // Special remove syntax
        {
          listPath = customPathParts.join('/');
          customPathParts.splice(2, 1);
        } else {
          customPathParts[2] = typeInfo[objectName].customUrls.listUrl;
        }

        newPath = customPathParts.join('/');
      }

      var origNewPath = newPath;

      // TODO, DETECT IF FILE ALREADY EXISTS, IF IT DOES APPEND A NUMBER TO IT DUMMY
      if(baseName === 'list')
      {
        newPath = newPath + '/index.html';

        if(listPath) {
          newPath = listPath + '/index.html';
        }

        await writeTemplate(file, newPath, { emitter: opts.emitter });

      } else if (baseName === 'individual') {
        // Output should be path + id + '/index.html'
        // Should pass in object as 'item'
        baseNewPath = newPath;
        var previewPath = baseNewPath.replace('./.build', './.build/_wh_previews');

        // TODO: Check to make sure file does not exist yet, and then adjust slug if it does? (how to handle in swig functions)
        for(var key in publishedItems)
        {
          var val = publishedItems[key];

          if(templateWidgetName && val[templateWidgetName]) {
            overrideFile = 'templates/' + objectName + '/layouts/' + val[templateWidgetName];
          }

          var addSlug = true;
          if(val.slug) {
            baseNewPath = './.build/' + val.slug + '/';
            addSlug = false;
          } else {
            if(typeInfo[objectName] && typeInfo[objectName].customUrls && typeInfo[objectName].customUrls.individualUrl) {
              baseNewPath = origNewPath + '/' + utils.parseCustomUrl(typeInfo[objectName].customUrls.individualUrl, val) + '/';
            } else {
              baseNewPath = origNewPath + '/';
            }
          }

          var tmpSlug = '';
          if(!val.slug) {
            tmpSlug = generateSlug(val);
          } else {
            tmpSlug = val.slug;
          }

          if(addSlug) {
            val.slug = baseNewPath.replace('./.build/', '') + tmpSlug;
            newPath = baseNewPath + tmpSlug + '/index.html';
          } else {
            newPath = baseNewPath + 'index.html';
          }

          if(await fileExists(overrideFile)) {
            await writeTemplate(overrideFile, newPath, { item: val, emitter: opts.emitter });
            overrideFile = null;
          } else {
            await writeTemplate(file, newPath, { item: val, emitter: opts.emitter });
          }
        }

        // early return if we are not building preview pages
        if ( build_preview === false ) return;

        for(var key in items)
        {
          var val = items[key];

          if(templateWidgetName && val[templateWidgetName]) {
            overrideFile = 'templates/' + objectName + '/layouts/' + val[templateWidgetName];
          }

          newPath = previewPath + '/' + val.preview_url + '/index.html';

          if(await fileExists(overrideFile)) {
            await writeTemplate(overrideFile, newPath, { item: val, emitter: opts.emitter });
            overrideFile = null;
          } else {
            await writeTemplate(file, newPath, { item: val, emitter: opts.emitter });
          }
        }

      } else if(filePath.indexOf('templates/' + objectName + '/layouts') !== 0) { // Handle sub pages in here
        baseNewPath = newPath;

        var middlePathName = filePath.replace('templates/' + objectName, '') + '/' + baseName;
        middlePathName = middlePathName.substring(1);

        for(var key in publishedItems)
        {
          var val = publishedItems[key];

          var addSlug = true;
          if(val.slug) {
            baseNewPath = './.build/' + val.slug + '/';
            addSlug = false;
          } else {
            if(typeInfo[objectName] && typeInfo[objectName].customUrls && typeInfo[objectName].customUrls.individualUrl) {
              baseNewPath = origNewPath + '/' + utils.parseCustomUrl(typeInfo[objectName].customUrls.individualUrl, val) + '/';
            }   else {
              baseNewPath = origNewPath + '/';
            }
          }

          var tmpSlug = '';
          if(!val.slug) {
            tmpSlug = generateSlug(val);
          } else {
            tmpSlug = val.slug;
          }

          if(addSlug) {
            val.slug = baseNewPath.replace('./.build/', '') + tmpSlug;
            newPath = baseNewPath + tmpSlug + '/' + middlePathName + '/index.html';
          } else {
            newPath = baseNewPath + middlePathName + '/index.html';
          }

          await writeTemplate(file, newPath, { item: val, emitter: opts.emitter });
        }
      }
    }
  }


  function buildInParallel ( concurrency ) {
    return concurrency > 1
  }


  /**
   * Renders all templates in the /templates directory to the build directory
   * @param  {object}     opts?
   * @param  {number}     opts?.concurrency?  Number of CPUs to use when building templats.
   * @param  {string|object}  opts.data?      The data to use
   * @param  {string|object}  opts.settings?  The settings to use
   * @param  {string}     opts?.templates?    The template filtering string to pass into renderTemplates
   * @param  {boolean}    opts?.emitter?      Boolean to determine if the build process should emit events of progress to process.stdin
   *                                          If true, other processes can operate on the partially built site.
   * @param  {Function}   done     Callback passed either a true value to indicate its done, or an error
   * @param  {Function}   cb       Callback called after finished, passed list of files changed and done function
   */
  this.renderTemplates = async function(opts, done, cb) {
    logger.ok('Rendering Templates');
    generatedSlugs = {};

    var queryFiles = opts.templates || 'templates/**/*';
    queryFiles = (queryFiles.indexOf('templates') === 0)
      ? queryFiles
      : path.join('templates', queryFiles);

    var concurrency = opts.concurrency || 1;

    if ( opts.settings ) setSettingsFrom( opts.settings )
    if ( opts.data ) setDataFrom( opts.data )

    const { data, typeInfo } = await getData()
    const files = await pglob(queryFiles, { nodir: true })

    var filesToBuild = files
      .filter(onlyHtmlFiles)
      .filter(notAPartial)
      .filter(isFilePath);

    if ( filesToBuild.length === 0 ) {
      if (cb) cb(done)
      return Promise.resolve()
    }

    var spawnedCommands = spawnedCommandsInterface()
    let buildTasks;
    if ( buildInParallel( concurrency ) )
      buildTasks = filesToBuild.map(fileToParallelBuildTaskCmd(spawnedCommands.add));
    else
      buildTasks = filesToBuild.map(fileToBuildTask);

    return new Promise((resolve, reject) => {
      async.parallelLimit( buildTasks, concurrency, buildComplete )

      function buildComplete ( error, results ) {
        if ( error ) {
          // kill all spawnedCommands
          spawnedCommands.terminate()
          // callback with error
          if (cb) cb( error )
          return reject(error)
        }

        logger.ok('Finished Rendering Templates');

        if(cb) cb(done);
        return resolve()
      }
    })

    function onlyHtmlFiles (file) {
      return (path.extname(file) === '.html');
    }

    function notAPartial (file) {
      return (file.indexOf('templates/partials') !== 0);
    }

    function isFilePath (file) {
      return (path.dirname(file).split('/').length > 1);
    }

    function fileToParallelBuildTaskCmd ( addSpawnedCommands ) {

      return fileToParallelBuildTask;

      function fileToParallelBuildTask ( file ) {
        var args = [ 'run', 'build-template', '--' ];
        args = args.concat( [ '--inFile=' + file ] )
        args = args.concat( [ '--data=' + DATA_CACHE_PATH ] )

        var pipe = opts.emitter ? false : true; // write to child thread?

        if ( strictMode ) {
          pipe = false;  // if strict mode, we are deploying, and want to see error messages.
          args = args.concat( [ '--strict=true' ] )
        }
        if ( opts.emitter ) args = args.concat( [ '--emitter' ] )

        return addSpawnedCommands( args, pipe )
      }

    }

    function fileToBuildTask ( file ) {
      return function buildTask ( step ) {
        self.renderTemplate(
          { file: file, data: data, emitter: opts.emitter },
          function onComplete () {
            step();
          } )
      }
    }

    function spawnedCommandsInterface () {
      var spawned = []

      return {
        add: addArgsForCmd,
        terminate: terminateSpawned,
      }

      function addArgsForCmd ( args, pipe ) {
        return function parallelBuildTask ( step ) {
          var cmd = runCommand(options.npm || 'npm', '.', args, pipe)

          cmd.on( 'exit', function ( exitCode ) {
            untrackSpawnedCmd( cmd.pid )
            if ( exitCode && typeof exitCode === 'number' && exitCode > 0 ) {
              var errorMessage = `
                Failed running:

                npm ${ args.join( ' ' ) }

                Scroll up to see the stack trace will let you know where the error occurred.
              `.trim()
               .split( '\n' )
               .map( function trimLines ( line ) { return line.trim() } )
               .join( '\n' )
              return step( new Error( errorMessage ) )
            }
            step()
          } )

          spawned = spawned.concat( [ cmd ] )
        }
      }

      function terminateSpawned () {
        spawned.forEach( function killCmd ( cmd ) { cmd.kill() } )
      }

      function untrackSpawnedCmd ( pid ) {
        var indexInSpawned = spawned.map( pluckPid ).indexOf( pid )

        if ( indexInSpawned === -1 ) return

        spawned.splice( indexInSpawned, 1 )

        function pluckPid ( cmd ) { return cmd.pid }
      }
    }
  }

  /**
   * Copies the static directory into .build/static for asset generation
   * @param  {boolean}  opts
   * @param  {string}   opts.baseDirectory?  Optional directory to copy. Sefaults to 'static'
   * @param  {boolean}  opts.emitter?      Boolean to determine if the build process should emit events of progress to process.stdin
   *                                        If true, other processes can operate on the partially built site.
   * @param  {Function} callback     Callback called after creation of directory is done
   */
  this.copyStatic = async function(opts, callback) {
    logger.ok('Copying static');
    var baseDirectory = opts.baseDirectory ? opts.baseDirectory : 'static';
    if(await fileExists(baseDirectory)) {
      var staticDirectory = path.join( '.build', baseDirectory )
      await mkdirp(staticDirectory)
      try {
        await fse.copy(baseDirectory, staticDirectory)
      } catch (error) {
        debug('copy-static:copy:error')
        debug(error)
      }
      if (opts.emitter || typeof process.send === 'function') {
        try {
          const buildStaticFiles = await pglob('**/*', { cwd: staticDirectory, nodir: true })  
          debug('copy-statc:build-static-files')
          buildStaticFiles.forEach( function ( builtFile ) {
            var builtFilePath = path.join( staticDirectory, builtFile );
            if (opts.emitter) console.log( BUILD_DOCUMENT_WRITTEN(`./${ builtFilePath }`) )
            if (typeof process.send === 'function') process.send(BUILD_DOCUMENT_WRITTEN(`./${ builtFilePath }`))
          } )
        } catch (error) {
          debug('copy-static:emit-built-files:error')
          debug(error)
        }
      }
    }
    if (callback) callback();
    return Promise.resolve()
  };

  self.staticHashs = false;
  self.changedStaticFiles = [];

  /**
  * This creates a hash table of all the static files, used to send detailed information to livereload
  * We only do this for static files for speed, for regular files a full reload usually is ok.
  */
  var createStaticHashs = async function() {
    debug('create-static-hashes')
    self.staticHashs = {};
    self.changedStaticFiles = [];

    if(await fileExists('.build/static')) {
      var files = await pglob('**/*', { cwd: '.build/static', nodir: true })

      const hashers = files.map(function(file) {
        return new Promise(async (resolve, reject) => {
          const staticPath = '.build/static/' + file;
          if(!await isDirectory(staticPath)) {
            try {
              const content = await readFile(staticPath)
              var hash = md5(content)
              self.staticHashs[staticPath] = hash
            } catch (error) {
              debug('create-static-hashes:error')
              debug(error)
            }
          }
          resolve()
        })
      })

      await Promise.all(hashers)
    } else {
      self.staticHashs = false;
      self.changedStaticFiles = [];
    }

    return Promise.resolve()
  }

  /**
   * Cleans the build directory
   * @param  {Function}   done     Callback passed either a true value to indicate its done, or an error
   * @param  {Function}   cb       Callback called after finished, passed list of files changed and done function
   */
  this.cleanFiles = async function(done, cb) {
      logger.ok('Cleaning files');
      await fse.remove('.build')
      if (done) done()
      if (cb) cb()
      debug('clean-files:resolve')
      return Promise.resolve()
  };

  var buildQueue = async.queue(async function (task, callback) {
    debug('build-queue')
    if(task.type === 'static') {
      debug('build-queue:static')

      // For static builds we create a hash table to send correct livereload info
      // We only do this for static files for speed, normal builds dont really matter
      await createStaticHashs()

      debug('remove:static')
      await fse.remove('.build/static')
      var copyStaticOptions = {
        emitter: task.emitter
      }
      await self.copyStatic(copyStaticOptions)
      await self.reloadFiles()
      if (callback) callback()
      return Promise.resolve()
    }
    else if (task.type === 'styles') {
      debug('build-queue:styles')
      var copyStaticOptions = {
        emitter: task.emitter,
        baseDirectory: path.join('static', 'css')
      }
      await self.copyStatic(copyStaticOptions)
      await self.reloadFiles()
      if (callback) callback()
      return Promise.resolve()
    }
    else if (task.type === 'scripts') {
      debug('build-queue:scripts')
      var copyStaticOptions = {
        emitter: task.emitter,
        baseDirectory: path.join('static', 'javascript'),
      }
      await self.copyStatic(copyStaticOptions)
      await self.reloadFiles()
      if (callback) callback()
      return Promise.resolve()
    }
    else {
      var buildBothOptions = {
        concurrency: task.concurrency,
        emitter: task.emitter,
        data: task.data,
        pages: task.pages,
        templates: task.templates,
      }
      await self.realBuildBoth(buildBothOptions)
      await self.reloadFiles()
      if (callback) callback()
      return Promise.resolve()
    }
  }, 1);

  this.buildBoth = function(opts, done) {
    var task = {
      type: 'all',
      concurrency: opts.concurrency,
      emitter: opts.emitter,
      data: opts.data,
      pages: opts.pages,
      templates: opts.templates,
    }
    buildQueue.push( task, function(error) {
      if ( error ) {
        return done( error )
      }
      done()
    });
  };

  var readData = function ( readFrom ) {
    if ( typeof readFrom === 'object'  ) return readFrom;

    var read = false; // default value
    if ( typeof readFrom === 'undefined' ) return read;

    try { // reading from stringified json?
        read = JSON.parse(readFrom)
      } catch (e) {
        // not json
        try { // reading from json file?
          read = JSON.parse(
            fs.readFileSync( readFrom )
              .toString())
        } catch (e) {
          console.error( e.message );
        }
      }

    return read;
  }

  /**
   * Write data to the path
   * @param  {object}  options
   * @param  {string}  options.file  The file to write to
   * @param  {object}  options.data  The data to write to file
   * @return {string}  file          The file written to
   */
  var writeDataCache = async function ( options ) {
    if ( !options ) options = {}

    await mkdirp( path.dirname( options.file ) );

    if ( typeof options.data === 'function') var data = options.data();
    if ( typeof options.data === 'object' )  var data = JSON.stringify( options.data );

    await writeFile(options.file, data)
    return Promise.resolve(options.file)
  }

  /**
   * If a data object is passed in, it is set as the
   * `self.cachedData` & `data` objects that get used
   * throughout the generator.
   *
   * @param {object} optionalData Webhook CMS data object
   */
  function setDataFrom ( optionalData ) {
    var data = readData( optionalData )
    if ( ( typeof data === 'object' ) &&
         data.hasOwnProperty( 'data' ) &&
         ( data.hasOwnProperty( 'contentType' ) ||
           data.hasOwnProperty( 'typeInfo' ) ) &&
         data.hasOwnProperty( 'settings' ) ) {

      if ( data.hasOwnProperty( 'contentType' ) ) {
        data.typeInfo = data.contentType;
        delete data.contentType;
      }

      self.cachedData = data;
      return true;
    }
    else return false;
  }

  function setSettingsFrom ( optionalSettings ) {
    var settings = readData( optionalSettings )
    if ( ( typeof settings == 'object' ) ) {
      self._settings = settings;
      return true;
    }
    else return false;
  }

  /**
   * Render a single page
   * @param  {object}   opts
   * @param  {string}   opts.inFile
   * @param  {string}   opts.outFile?
   * @param  {string|object}  opts.data?
   * @param  {string|object}  opts.settings?
   * @param  {boolean}  opts.emitter?
   * @param  {Function} done?  callback when done
   */
  this.renderPage = async function (opts, done) {
    if ( ! opts.outFile ) opts.outFile = opts.inFile.replace('pages/', './.build/')

    if ( opts.data ) setDataFrom( opts.data )
    if ( opts.settings ) setSettingsFrom( opts.settings )

    const data = await getData()
    
    if ( opts.emitter ) console.log( BUILD_PAGE_START( opts.inFile ) )
    var extension = path.extname( opts.inFile );
    if (templateExtensions.indexOf(extension) !== -1) {
      await writeTemplate( opts.inFile, opts.outFile, { emitter: opts.emitter } )
    } else {
      await mkdirp( path.dirname( opts.outFile ) )
      try {
        const content = await fsp.readFile(opts.inFile)
        await writeDocument({
          file: opts.outFile,
          content,
          emitter: opts.emitter,
        })
      } catch (error) {
        throw error
      }
    }

    if ( opts.emitter ) console.log( BUILD_PAGE_END( opts.inFile ) )
    if (done) done()
  }

  /**
   * Build static task.
   * @param  {boolean}  opts
   * @param  {boolean}  opts.emitter?  Boolean to determine if the build process should emit events of progress to process.stdin
   *                                   If true, other processes can operate on the partially built site.
   * @param  {Function} done Task done callback.
   */
  this.buildStatic = async function(opts, done) {
    var task = { type: 'static' };

    return new Promise((resolve, reject) => {
      buildQueue.push(Object.assign( task, opts ), function( error ) {
        if (error && done) done(error)
        if (error) return reject(error)
        if (done) done()
        resolve()
      });
    })
  };

  this.buildStyles = function (opts, done) {
    var task = { type: 'styles' };

    buildQueue.push(Object.assign( task, opts ), function( error ) {
      if ( error ) {
        return done( error )
      }
      done();
    });
  }

  this.buildScripts = function (opts, done) {
    var task = { type: 'scripts' };

    buildQueue.push(Object.assign( task, opts ), function( error ) {
      if ( error ) {
        return done( error )
      }
      done();
    });
  }

  /**
   * Builds templates from both /pages and /templates to the build directory
   * @param  {object}     opts
   * @param  {number}     opts.concurrency  Number of CPUs to use for build tasks
   * @param  {string|object}  opts.data?
   * @param  {string|object}  opts.settings?
   * @param  {string}     opts.templates?   The template filtering string to pass into renderTemplates
   * @param  {string}     opts.pages?       The page filtering string to pass into renderTemplates
   * @param  {boolean}    opts.emitter?     Boolean to determine if the build process should emit events of progress to process.stdin
   *                                        If true, other processes can operate on the partially built site.
   * @param  {Function}   done     Callback passed either a true value to indicate its done, or an error
   * @param  {Function}   cb       Callback called after finished, passed list of files changed and done function
   */
  this.realBuildBoth = async function(opts, done, cb) {
    debug('real-build-both')
    debug(opts)
    self.cachedData = null;
    var series = []

    let dataSet
    if ( opts.data ) {
      dataSet = setDataFrom( opts.data )
      setSettingsFrom( opts.settings )
    }
    else {
      dataSet = false;
      series = series.concat( [ cleanFilesStep ] )
    }

    if ( dataSet === false ) series = series.concat( [ getDataStep ] )

    if ( buildInParallel( opts.concurrency ) ) series = series.concat( [ writeDataCacheStep ] )

    series = series.concat( [
      renderTemplatesStep( opts ),
      copyStaticStep( opts ),
      renderPagesStep( opts ),
    ] )

    return new Promise((resolve, reject) => {
      async.series( series, handleSeries )

      function handleSeries ( error ) {
        if (error && done) done(error)
        if (cb && done) cb( done )
        if (error) return reject(error)
        resolve()
      }
    })

    async function cleanFilesStep (step) {
      await self.cleanFiles()
      step()
    }

    async function getDataStep ( step ) {
      await getData()
      step()
    }

    async function writeDataCacheStep ( step ) {
      await writeDataCache( { file: DATA_CACHE_PATH, data: self.cachedData } )
      step()
    }

    function renderTemplatesStep ( opts ) {
      return async function renderTemplatesStepFn ( step ) {
        await self.renderTemplates(opts)
        step()
      }
    }

    function copyStaticStep ( opts ) {
      return async function copyStaticFn ( step ) {
        await self.copyStatic( opts )
        step()
      }
    }

    function renderPagesStep ( opts ) {
      return async function renderPagesStepFn ( step ) {
         await self.renderPages( opts )
         step()
      }
    }
  };

  this.checkScaffoldingMD5 = function(name, callback) {
    self.cachedData = null;
    getData(function(data, typeInfo) {
      var directory = 'templates/' + name + '/';
      var individual = directory + 'individual.html';
      var list = directory + 'list.html';
      var oneOff = 'pages/' + name + '.html';

      var individualMD5 = null;
      var listMD5 = null;
      var oneOffMD5 = null;

      if(typeInfo[name].oneOff) {
        if(fs.existsSync(oneOff)) {
          var oneOffContent = fs.readFileSync(oneOff);
          oneOffMD5 = md5(oneOffContent);
        }
      } else {
        if(fs.existsSync(individual)) {
          var indContent = fs.readFileSync(individual);
          individualMD5 = md5(indContent);
        }

        if(fs.existsSync(list)) {
          var listContent = fs.readFileSync(list);
          listMD5 = md5(listContent);
        }
      }

      callback(individualMD5, listMD5, oneOffMD5);
    });
  }

  /**
   * Generates scaffolding for content type with name
   * @param  {String}   name     Name of content type to generate scaffolding for
   * @param  {Function}   done     Callback called when scaffolding generation is done
   * @param  {Boolean}   force    If true, forcibly overwrites old scaffolding
   */
  this.makeScaffolding = function(name, done, force) {
    logger.ok('Creating Scaffolding for ' + name + '\n');
    var directory = 'templates/' + name + '/';

    var list = directory + 'list.html';
    var individual = directory +  'individual.html';
    var oneOff = 'pages/' + name + '.html';

    var individualTemplate = fs.readFileSync('./libs/scaffolding_individual.html');
    var listTemplate = fs.readFileSync('./libs/scaffolding_list.html');
    var oneOffTemplate = fs.readFileSync('./libs/scaffolding_oneoff.html');

    var widgetFilesRaw = [];

    if(fs.existsSync('./libs/widgets')) {
      widgetFilesRaw = wrench.readdirSyncRecursive('./libs/widgets');
    }

    var widgetFiles = [];

    widgetFilesRaw.forEach(function(item) {
      widgetFiles[(path.dirname(item) + '/' + path.basename(item, '.html')).replace('./', '')] = true;
    });

    var renderWidget = function(controlType, fieldName, controlInfo, overridePrefix) {
      var controls = [];

      if(controlInfo.controls) {
        _.each(controlInfo.controls, function(item) {
          controls[item.name] = item;
        });
      }

      var prefix = overridePrefix || 'item.';

      var widgetString = _.template(fs.readFileSync('./libs/widgets/' + controlType + '.html'))({ value: prefix + fieldName, controlInfo: controlInfo, renderWidget: renderWidget, controls: controls, widgetFiles: widgetFiles });

      var lines = widgetString.split('\n');
      var newLines = [];
      var first = true;

      lines.forEach(function(line) {
        if(first) {
          first = false;
          newLines.push(line);
        } else {
          var newLine = '        ' + line;
          newLines.push(newLine);
        }
      });

      return newLines.join('\n');
    };

    self.cachedData = null;
    getData(function(data, typeInfo) {
      var controls = typeInfo[name] ? typeInfo[name].controls : [];
      var controlsObj = {};

      _.each(controls, function(item) {
        controlsObj[item.name] = item;
      });

      var individualMD5 = null;
      var listMD5 = null;
      var oneOffMD5 = null;

      if(typeInfo[name].oneOff) {
        if(!force && fs.existsSync(oneOff)) {
          if(done) done(null, null, null);
          logger.error('Scaffolding for ' + name + ' already exists, use --force to overwrite');
          return false;
        }

        var oneOffFile = _.template(oneOffTemplate)({ widgetFiles: widgetFiles, typeName: name, typeInfo: typeInfo[name] || {}, controls: controlsObj, 'renderWidget' : renderWidget });
        oneOffFile = oneOffFile.replace(/^\s*\n/gm, '');

        oneOffMD5 = md5(oneOffFile);
        fs.writeFileSync(oneOff, oneOffFile);
      } else {

        if(!force && fs.existsSync(directory)) {
          if(done) done(null, null, null);
          logger.error('Scaffolding for ' + name + ' already exists, use --force to overwrite');
          return false;
        }

        mkdirp.sync(directory);

        var template = _.template(individualTemplate)({ widgetFiles: widgetFiles, typeName: name, typeInfo: typeInfo[name] || {}, controls: controlsObj, 'renderWidget' : renderWidget });
        template = template.replace(/^\s*\n/gm, '');

        individualMD5 = md5(template);
        fs.writeFileSync(individual, template);

        var lTemplate = _.template(listTemplate)({ typeName: name });

        listMD5 = md5(lTemplate);
        fs.writeFileSync(list, lTemplate);
      }

      if(done) done(individualMD5, listMD5, oneOffMD5);
    });

    return true;
  };

  /**
   * Send signal to local livereload server to reload files
   * @param  {Array}      files     List of files to reload
   * @param  {Function}   done      Callback passed either a true value to indicate its done, or an error
   */
  this.reloadFiles = async function(done) {
    debug('reload-files')
    var fileList = 'true';

    if(self.staticHashs !== false && fs.existsSync('.build/static')) {
      var newFiles = await pglob('**/*', { cwd: '.build/static', nodir: true })

      newFiles.forEach(function(file) {
        var file = '.build/static/' + file;


        if(!fs.lstatSync(file).isDirectory()) {
          var hash = md5(fs.readFileSync(file));

          if(hash !== self.staticHashs[file]) {
            self.changedStaticFiles.push(file.replace('.build', ''));
          }

          if(file in self.staticHashs) {
            delete self.staticHashs[file];
          }
        }
      })

      // For any left over keys, means they got deleted
      for(var key in self.staticHashs) {
        self.changedStaticFiles.push(key.replace('.build', ''));
      }

      if(self.changedStaticFiles.length === 0) {
        if(done) done(true);
        self.staticHashs = false;
        self.changedStaticFiles = [];
        return Promise.resolve()
      }

      fileList = self.changedStaticFiles.join(',');

      self.staticHashs = false;
      self.changedStaticFiles = [];
    }

    return new Promise ((resolve, reject) => {
      request({ url : 'http://localhost:' + liveReloadPort + '/changed?files=' + fileList, timeout: 10  }, function(error, response, body) {
        if(done) done(true);
        resolve()
      });
    })
  };

  /**
   * Starts a live reload server, which will refresh the pages when signaled
   */
  this.startLiveReload = function() {
    tinylr({ liveCSS: true, liveImg: true }).listen(liveReloadPort);
  };

  /**
   * Sends a message to the CMS through a websocket initiated by the CMS
   * @param  {String}      message    Message to send
   */
  this.sendSockMessage = function(message) {
    if(websocket) {
      websocket.sendText('message:' + JSON.stringify(message));
    }
  };

  // cmd : str , cwd : str, args : [], pipe : boolean, cb? : function?
  var runCommand = function(cmd, cwd, args, pipe, cb) {
    if(typeof pipe == 'function') {
      cb = pipe;
      pipe = false;
    }

    var commandError = null;

    var command = spawn(cmd, args, {
      stdio: [process.stdin, pipe ? 'pipe' : process.stdout, process.stderr],
      cwd: cwd
    });

    if ( typeof cb !== 'function' ) {
      return command;
    }

    var output = '';

    if(pipe) {
      command.stdout.on('data', function(data) {
        output += data;
      });
    }

    command.on( 'error', function () {
      commandError = new Error( `Failed to run: ${ cmd } ${ args.join( ' ' ) }` )
    } )

    command.on('close', function() {
      cb( commandError, output );
    })
  }

  var runNpm = function(cb) {
    if(options.npmCache) {
      runCommand(options.npm || 'npm', '.', ['config', 'get', 'cache'], true, function(error, diroutput) {
        if ( error ) return cb( error )
        var oldCacheDir = diroutput.trim();
        runCommand(options.npm || 'npm', '.', ['config', 'set', 'cache', options.npmCache], function( error ) {
          if ( error ) return cb( error )
          runCommand(options.npm || 'npm', '.', ['install'], function( error ) {
            if ( error ) return cb( error )
            runCommand(options.npm || 'npm', '.', ['config', 'set', 'cache', oldCacheDir], function( error ) {
              if ( error ) return cb( error )
              cb();
            });
          });
        });
      });
    } else {
      runCommand(options.npm || 'npm', '.', ['install'], function(error) {
        console.log('NPM done');
        cb(error);
      });
    }
  };

  /**
   * Starts a websocket listener on 0.0.0.0 (for people who want to run wh serv over a network)
   * Accepts messages for generating scaffolding and downloading preset themes.
   */
  this.webListener = function() {
    var server = new websocketServer.createServer(function(sock) {

      websocket = sock;

      sock.on('close', function() {
        websocket = null;
      });

      sock.on('error', function() {
      })

      sock.on('text', function(message) {
        if(message.indexOf('scaffolding:') === 0)
        {
          var name = message.replace('scaffolding:', '');
          self.makeScaffolding(name, function(individualMD5, listMD5, oneOffMD5) {
            sock.sendText('done:' + JSON.stringify({ individualMD5: individualMD5, listMD5: listMD5, oneOffMD5: oneOffMD5 }));
          });
        } else if (message.indexOf('scaffolding_force:') === 0) {
          var name = message.replace('scaffolding_force:', '');
          self.makeScaffolding(name, function(individualMD5, listMD5, oneOffMD5) {
            sock.sendText('done:' + JSON.stringify({ individualMD5: individualMD5, listMD5: listMD5, oneOffMD5: oneOffMD5 }));
          }, true);
        } else if (message.indexOf('check_scaffolding:') === 0) {
          var name = message.replace('check_scaffolding:', '');
          self.checkScaffoldingMD5(name, function(individualMD5, listMD5, oneOffMD5) {
            sock.sendText('done:' + JSON.stringify({ individualMD5: individualMD5, listMD5: listMD5, oneOffMD5: oneOffMD5 }));
          });
        } else if (message === 'reset_files') {
          resetGenerator(function(error) {
            if(error) {
              sock.sendText('done:' + JSON.stringify({ err: 'Error while resetting files' }));
            } else {
              sock.sendText('done');
            }
          });
        } else if (message === 'supported_messages') {
          sock.sendText('done:' + JSON.stringify([
            'scaffolding', 'scaffolding_force', 'check_scaffolding', 'reset_files', 'supported_messages',
            'push', 'build', 'preset', 'layouts', 'preset_localv2', 'generate_slug_v2'
          ]));
        } else if (message.indexOf('generate_slug_v2:') === 0) {
          var obj = JSON.parse(message.replace('generate_slug_v2:', ''));
          var type = obj.type;
          var name = obj.name;
          var date = obj.date;

          getTypeData(type, function(typeInfo) {
            var tmpSlug = '';
            tmpSlug = slug(name).toLowerCase();

            if(typeInfo && typeInfo.customUrls && typeInfo.customUrls.individualUrl) {
              tmpSlug = utils.parseCustomUrl(typeInfo.customUrls.individualUrl, date) + '/' + tmpSlug;
            }

            if(typeInfo && typeInfo.customUrls && typeInfo.customUrls.listUrl) {

              if(typeInfo.customUrls.listUrl === '#') {
                tmpSlug = tmpSlug;
              } else {
                tmpSlug = typeInfo.customUrls.listUrl + '/' + tmpSlug;
              }
            } else {
              tmpSlug = type + '/' + tmpSlug;
            }

            sock.sendText('done:' + JSON.stringify(tmpSlug));
          });
        } else if (message === 'build') {
          buildQueue.push({ type: 'all' }, function(err) {
            sock.sendText('done');
          });
        } else if (message.indexOf('preset_local:') === 0) {
          var fileData = message.replace('preset_local:', '');

          if(!fileData) {
            sock.sendText('done');
            return;
          }

          extractPresetLocal(fileData, function(data) {
            runNpm(function() {
              sock.sendText('done:' + JSON.stringify(data));
            });
          });
        } else if (message.indexOf('preset:') === 0) {
          var url = message.replace('preset:', '');
          if(!url) {
            sock.sendText('done');
            return;
          }
          downloadPreset(url, function(data) {
            runNpm(function() {
              sock.sendText('done:' + JSON.stringify(data));
            });
          });
        } else {
          sock.sendText('done');
        }
      });
    }).listen(cmsSocketPort, '0.0.0.0');
  };

  /**
   * Inintializes firebase configuration for a new site
   * @param  {Object}    firebaseConfOptions Object to be used in creating the .firebase.conf file.
   * @param  {Boolean}   copyCms   True if the CMS should be overwritten, false otherwise
   * @param  {Function}  done      Callback to call when operation is done
   */
  this.init = function(firebaseConfOptions, copyCms, done) {
    var oldConf = config.get('webhook');

    var confFile = fs.readFileSync('./libs/.firebase.conf.jst');

    if(firebaseConfOptions && firebaseConfOptions.firebase) {
      confFile = fs.readFileSync('./libs/.firebase-custom.conf.jst');
    }

    // TODO: Grab bucket information from server eventually, for now just use the site name
    var baseOptions = {
      noSearch: null,
      imageproxy: null,
    }
    var templated = _.template(confFile)( Object.assign( {}, baseOptions, oldConf, firebaseConfOptions ));

    fs.writeFileSync('./.firebase.conf', templated);

    if(copyCms) {
      var cmsFile = fs.readFileSync('./libs/cms.html');

      var cmsTemplated = _.template(cmsFile)({
        siteName: firebaseConfOptions.siteName,
        title: cmsTitleForSiteName( firebaseConfOptions.siteName ),
      });

      mkdirp.sync('./pages/');

      fs.writeFileSync('./pages/cms.html', cmsTemplated);
    }

    done(true);

    function cmsTitleForSiteName ( siteName ) {
      var base = 'CMS'
      if ( ! siteName ) return base;
      return `${ siteName.split( ',1' )[ 0 ] } ${base}`
    }
  };

  /**
   * Sets up asset generation (automatic versioning) for pushing to production
   * @param  {Object}    grunt  Grunt object from generatorTasks
   */
  this.assets = function(grunt, done) {

    removeDirectory('.whdist', function() {

      mkdirp.sync('.whdist');

      var files = wrench.readdirSyncRecursive('pages');

      files.forEach(function(file) {
        var originalFile = 'pages/' + file;
        var destFile = '.whdist/pages/' + file;

        if(!fs.lstatSync(originalFile).isDirectory())
        {
          var content = fs.readFileSync(originalFile);

          if(path.extname(originalFile) === '.html') {
            content = content.toString();
            content = content.replace('\r\n', '\n').replace('\r', '\n');
          }

          mkdirp.sync(path.dirname(destFile));
          fs.writeFileSync(destFile, content);
        }
      });

      files = wrench.readdirSyncRecursive('templates');

      files.forEach(function(file) {
        var originalFile = 'templates/' + file;
        var destFile = '.whdist/templates/' + file;

        if(!fs.lstatSync(originalFile).isDirectory())
        {
          var content = fs.readFileSync(originalFile);

          if(path.extname(originalFile) === '.html') {
            content = content.toString();
            content = content.replace('\r\n', '\n').replace('\r', '\n');
          }

          mkdirp.sync(path.dirname(destFile));
          fs.writeFileSync(destFile, content);
        }
      });

      files = wrench.readdirSyncRecursive('static');

      files.forEach(function(file) {
        var originalFile = 'static/' + file;
        var destFile = '.whdist/static/' + file;

        if(!fs.lstatSync(originalFile).isDirectory())
        {
          var content = fs.readFileSync(originalFile);

          if(path.extname(originalFile) === '.html') {
            content = content.toString();
            content = content.replace('\r\n', '\n').replace('\r', '\n');
          }

          mkdirp.sync(path.dirname(destFile));
          fs.writeFileSync(destFile, content);
        }
      });

      grunt.task.run('assetsMiddle');

      done();
    });

  }

  /**
   * Run asset versioning software if configs exist for them
   * @param  {Object}    grunt  Grunt object from generatorTasks
   */
  this.assetsMiddle = function(grunt) {
    grunt.option('force', false);

    if(!_.isEmpty(grunt.config.get('concat')))
    {
      grunt.task.run('concat');
    }

    grunt.task.run('rev');
    grunt.task.run('assetsAfter');
  }

  /**
   * Finish asset versioning
   * @param  {Object}    grunt  Grunt object from generatorTasks
   */
  this.assetsAfter = function(grunt, done) {
    removeDirectory('.tmp', function() {
      var files = wrench.readdirSyncRecursive('static');

      files.forEach(function(file) {
        var filePath = 'static/' + file;
        var distPath = '.whdist/static/' + file;
        if(!fs.lstatSync(filePath).isDirectory() && !fs.existsSync(distPath)) {
          var fileData = fs.readFileSync(filePath);
          fs.writeFileSync(distPath, fileData);
        }
      });

      done();
    });
  }

  /**
   * Enables strict mode, exceptions cause full crash, normally for production (so bad generators do not ruin sites)
   */
  this.enableStrictMode = function() {
    strictMode = true;
  }

  this.enableProduction = function() {
    productionFlag = true;
  }

  return this;
};
