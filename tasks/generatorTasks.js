
var curVersion = 'v55';

var request = require('request');

module.exports = function(grunt) {

  var firebaseUrl = 'webhook';
  var firebaseUri = null;
  if(firebaseUrl) {
    firebaseUri = 'https://' + firebaseUrl +  '.firebaseio.com/generator_version.json';
  }

  var checkVersion = function(callback) {
    if(firebaseUri === null) {
      callback();
    } else {
      request({ url: firebaseUri, json: true }, function(e, r, body) {
        if(body) {
          if(body !== curVersion) {
            console.log('========================================================'.red);
            console.log('# This site is using old Webhook code.     #'.red);
            console.log('========================================================'.red);
            console.log('#'.red + ' To update, run "wh update" in this folder.')
            console.log('# ---------------------------------------------------- #'.red)
          }

          callback();
        } else {
          callback();
        }
      });
    }
  };

  var npmBin = grunt.option('npmbin');
  var nodeBin = grunt.option('nodebin');
  var gruntBin = grunt.option('gruntbin');
  var token = grunt.option('token');
  var email = grunt.option('email');
  var npmCache = grunt.option('npmcache');

  var generator = require('../libs/generator').generator(grunt.config, { npm: npmBin, node: nodeBin, grunt: gruntBin, token: token, email: email, npmCache: npmCache }, grunt.log, grunt.file, root);

  grunt.registerTask('scaffolding', 'Generate scaffolding for a new object', function(name) {
    var done = this.async();

    var force = grunt.option('force');


    var result = generator.makeScaffolding(name, done, force);
  });

  grunt.registerTask('watch', 'Watch for changes in templates and regenerate site', function() {
    generator.startLiveReload();
    grunt.task.run('simple-watch');
  });

  grunt.registerTask('webListener', 'Listens for commands from CMS through websocket', function() {
    var done = this.async();
    generator.webListener(done);
  });

  grunt.registerTask('webListener-open', 'Listens for commands from CMS through websocket', function() {
    var done = this.async();
    generator.webListener(done);

    grunt.util.spawn({
      grunt: true,
      args: ['open:wh-open'].concat(grunt.option.flags()),
      opts: { stdio: 'inherit' }
    }, function (err, result, code) {
      if (err || code > 0) {
        grunt.log.warn('A problem occured while trying to open a browser window to connect to the site.')
        grunt.log.warn(result.stderr || result.stdout);
        grunt.log.warn('In order to access the site, please navigate to \'localhost:2002\' in your web browser.')
      }
      grunt.log.writeln('\n' + result.stdout);
    });
  });

  grunt.registerTask('clean', 'Clean build files', function() {
    var done = this.async();
    generator.cleanFiles(done);
  });

  grunt.registerTask('build-order', 'List the current build order for the site', function () {
    var done = this.async();
    generator.buildOrder( done )
  })

  // Build individual page
  grunt.registerTask('build-page', 'Build a single template file.', function (){
    var done = this.async();

    var strict = grunt.option('strict');

    if(strict === true) {
      generator.enableStrictMode();
    }

    var production = grunt.option('production');

    if(production === true) {
      generator.enableProduction();
    }
    
    var options = {
      inFile:  grunt.option('inFile'),
      outFile: grunt.option('outFile') || undefined,
      data: grunt.option('data') || undefined,
      settings: grunt.option('settings') || undefined,
      emitter: grunt.option('emitter') || undefined,
    }

    generator.renderPage(options, done);
  });

  grunt.registerTask('build-page-cms', 'Build just the CMS page.', function () {
    var done = this.async();

    var strict = grunt.option('strict');

    if(strict === true) {
      generator.enableStrictMode();
    }

    var production = grunt.option('production');

    if(production === true) {
      generator.enableProduction();
    }

    var options = {
      inFile:  'pages/cms.html',
      outFile: '.build/cms/index.html',
      data: grunt.option('data') || undefined,
      settings: grunt.option('settings') || undefined,
      emitter: grunt.option('emitter') || undefined,
    }

    generator.renderPage(options, done);
  })

  // Build individual template
  grunt.registerTask('build-template', 'Build a single template file.', function () {
    var done = this.async();

    var strict = grunt.option('strict');

    if(strict === true) {
      generator.enableStrictMode();
    }

    var production = grunt.option('production');

    if(production === true) {
      generator.enableProduction();
    }

    var options = {
      file: grunt.option('inFile'),
      emitter: grunt.option('emitter') || false,
      data: grunt.option('data') || undefined,
      settings: grunt.option('settings') || undefined,
      itemKey: grunt.option('itemKey') || undefined,
    }

    generator.renderTemplate(options, done);
  });

  grunt.registerTask('build-pages', 'Generate static files from pages directory', function() {
    var done = this.async();

    var strict = grunt.option('strict');

    if(strict === true) {
      generator.enableStrictMode();
    }

    var production = grunt.option('production');

    if(production === true) {
      generator.enableProduction();
    }

    var options = {
      concurrency: concurrencyOption( grunt.option('concurrency') ),
      emitter: grunt.option('emitter') || false,
      data: grunt.option('data') || undefined,
      settings: grunt.option('settings') || undefined,
      pages: grunt.option('pages') || undefined,
    };

    generator.renderPages(options, done, generator.reloadFiles);
  });

  grunt.registerTask('build-templates', 'Generate static files from templates directory', function() {
    var done = this.async();

    var strict = grunt.option('strict');

    if(strict === true) {
      generator.enableStrictMode();
    }

    var production = grunt.option('production');

    if(production === true) {
      generator.enableProduction();
    }

    var options = {
      concurrency: concurrencyOption( grunt.option('concurrency') ),
      emitter: grunt.option('emitter') || false,
      data: grunt.option('data') || undefined,
      settings: grunt.option('settings') || undefined,
      templates: grunt.option('templates') || undefined,
    };

    generator.renderTemplates(options, done, generator.reloadFiles);
  });

  grunt.registerTask('build-static', 'Just builds the static files, meant to be used with watch tasks.', function() {
    var done = this.async();

    var strict = grunt.option('strict');

    if(strict === true) {
      generator.enableStrictMode();
    }

    var production = grunt.option('production');

    if(production === true) {
      generator.enableProduction();
    }

    var options = {
      emitter: grunt.option('emitter') || false,
    };

    checkVersion(function() {
      generator.buildStatic(options, done);
    })
  });

  // Build Task.
  grunt.registerTask('build', 'Clean files and then generate static site into build', function() {
    var done = this.async();

    var strict = grunt.option('strict');

    if(strict === true) {
      generator.enableStrictMode();
    }

    var production = grunt.option('production');

    if(production === true) {
      generator.enableProduction();
    }

    var options = {
      concurrency: concurrencyOption( grunt.option('concurrency') ),
      emitter: grunt.option('emitter') || false,
      data: grunt.option('data') || undefined,
      pages: grunt.option('pages') || undefined,
      settings: grunt.option('settings') || undefined,
      templates: grunt.option('templates') || undefined,
    };

    checkVersion(function() {
      generator.buildBoth(options, function ( error ) {
        if ( error ) return grunt.fail.fatal( error )
        done()
      });
    })
  });

  grunt.registerTask('download-data', 'Downloads the site data to the common cached path. `./.build/data.json`.', function () {
    var done = this.async();
    var options = {
      file: grunt.option('toFile') || undefined,
    }
    generator.downloadData( options, done );
  });

  // Change this to optionally prompt instead of requiring a sitename
  grunt.registerTask('assets', 'Initialize the firebase configuration file (installer should do this as well)', function() {
    var done = this.async();
    generator.assets(grunt, done);
  });

  grunt.registerTask('assetsMiddle', 'Initialize the firebase configuration file (installer should do this as well)', function() {
    generator.assetsMiddle(grunt);
  });

  grunt.registerTask('assetsAfter', 'Initialize the firebase configuration file (installer should do this as well)', function() {
    var done = this.async();
    generator.assetsAfter(grunt, done);
  });

  // Change this to optionally prompt instead of requiring a sitename
  grunt.registerTask('init', 'Initialize the firebase configuration file (installer should do this as well)', function() {
    var done = this.async();

    var firebaseConfOptions = {
      siteName: grunt.option('siteName'),
      siteKey: grunt.option('siteKey'),
      firebase: grunt.option('firebaseName'),
      firebaseAPIKey: grunt.option('firebaseAPIKey'),
      embedlyKey: grunt.option('embedly'),
      serverAddr: grunt.option('server'),
      imgix_host: grunt.option('imgix_host'),
      imgix_secret: grunt.option('imgix_secret'),
      generator_url: grunt.option('generate'),
    }

    var copyCms = grunt.option('copycms');

    generator.init(firebaseConfOptions, copyCms, done);
  });

  // Check if initialized properly before running all these tasks
  grunt.registerTask('default',  'Clean, Build, Start Local Server, and Watch', function() {
    grunt.task.run('configureProxies:wh-server')
    grunt.task.run('connect:wh-server');
    if ( grunt.option( 'skipBuild' ) ) {
      grunt.task.run('build-page-cms')
    } else {
      grunt.task.run('build');  
    }
    grunt.task.run('concurrent:wh-concurrent');
  });

};

module.exports.version = curVersion;

// concurrency option value defaults to half the available cpus
function concurrencyOption ( concurrencyOptionValue ) {
  if ( typeof concurrencyOptionValue === 'number' ) return Math.floor( concurrencyOptionValue )
  if ( concurrencyOptionValue === 'max' ) return require('os').cpus().length;
  return require('os').cpus().length / 2;
}
