"use strict";

/**
 * Defines swig tags for templates
 * @param  {Object}   swig        Swig engine to add tags to
 * @param  {Object}   context     Context that all tags have access to
 */
module.exports.init = function(swig, context) {
  /**
   * Array of tagObjects. A tag object contains the keys
   * name, parse, compile, ends & blockLevel. These should follow
   * the definition outlined in the swig documentation.
   * http://node-swig.github.io/swig-templates/docs/extending/
   *
   * @type {Array}
   */
  var _user_tags = [];

  /**
   * Getter/Setter for user defined tags.
   * This expects an array of strings to resolve as paths to individual
   * tag definitions. Or a single tag object definition. Or an array of
   * tag object definitions.
   *
   * @param  {object[]|string[]|object|string} setUserTags  The tag definition(s)
   * @return {object[]|object}  Array of user tags, or this object context
   */
  this.userTags = function getSetUserTags(setUserTags) {
    if (!arguments.length) return _user_tags;

    if (Array.isArray(setUserTags)) {
      setUserTags.forEach(resolveTag);
    } else if (typeof setUserTags === "object") {
      resolveTag(setUserTags);
    } else if (typeof setUserTags === "string") {
      resolveTag(setUserTags);
    } else {
      throw new Error(
        "Expects input to be an array of strings that represent a file path, object or file path string."
      );
    }

    return this;

    function resolveTag(tagInput) {
      if (typeof tagInput === "string") {
        var toResolve = "./../" + tagInput;
        var tag = require(toResolve);
      } else {
        var tag = tagInput;
      }
      setTag(tag);
      _user_tags = _user_tags.concat([tag]);
    }

    function setTag(tagObject) {
      if (tagObject.name && tagObject.extension) {
        swig.setExtension(tagObject.name, tagObject.extension);
      }
      swig.setTag(
        tagObject.name,
        tagObject.parse,
        tagObject.compile,
        tagObject.ends,
        tagObject.blockLevel
      );
    }
  };
};
