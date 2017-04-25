(function() {
  'use strict';
})();

module.exports = function(grunt) {

  grunt.initConfig({
    pkc: grunt.file.readJSON('package.json'),

    // Watch files for changes and run tasks on changes
    watch: {
      sass: {
        files: ['scss/**/*.scss'],
        tasks: ['sass',
          'autoprefixer',
          'build-static'
        ]
      },
      browserify: {
        files: ['script/src/**/*.js'],
        tasks: ['jshint',
          'browserify:client',
          'build-static'
        ]
      },
      concat: {
        files: ['<%= concat.dist.src %>'],
        tasks: ['concat',
          'build-static'
        ]
      }
    },


    // Build scss to css
    sass: {
      dev: {
        options: {
          // WebHook will minifiy, so we don't have to here
          style: 'expanded',
          loadPath: require('node-neat').includePaths
        },
        files: [{
          expand: 'true',
          cwd: 'scss',
          src: ['site.scss'],
          dest: 'static/css',
          ext: '.css'
        }]
      }
    },


    // Add CSS prefixes once the Sass is compiled
    autoprefixer: {
      options: {
        browsers: ['last 2 versions', 'ie 9'],
        map: true
      },
      dist: {
        src: 'static/css/site.css',
        dest: 'static/css/site.css'
      }
    },


    // Detect errors and enforce consistency in Javascript
    jshint: {
      files: ['Gruntfile.js',
        'script/src/**/*.js',
        'script/test/**/*.js'
      ],
      options: {
        globals: {
          jQuery: true,
          console: true,
          module: true,
          require: true,
          global: true,
          window: true,
          document: true,
          $f: true
        },
        curly: true,
        eqeqeq: true,
        immed: true,
        indent: 4,
        noarg: true,
        nonbsp: true,
        quotmark: 'single',
        undef: true,
        unused: true,
        force: true
      }
    },

    // Build process for Javascript
    browserify: {
      client: {
        src: ['script/src/index.js'],
        dest: 'static/javascript/site.js'
      }
    },

    concat: {
      options: {
        separator: '\n\n'
      },
      dist: {
        src: ['script/lib/**/*.js'],
        dest: 'static/javascript/lib.js'
      }
    },

  });

  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-sass');
  grunt.loadNpmTasks('grunt-autoprefixer');
  grunt.loadNpmTasks('grunt-browserify');

  // NEVER REMOVE THESE LINES, OR ELSE YOUR PROJECT MAY NOT WORK
  require('./options/generatorOptions.js')(grunt);
  grunt.loadTasks('tasks');
};
