var _                     = require("lodash");
var Promise               = require('bluebird');
var Bcrypt                = Promise.promisifyAll(require("bcryptjs"));
var Checkit               = require('checkit');
var Crypto                = require('crypto');
var moment                = require('moment');
var PasswordResetException = require('../lib/password_reset_exception');

function encryptPassword(password) {
  return Bcrypt.hashAsync(password, 10);
};

module.exports = function(Bookshelf, app) {
  var query   = Bookshelf.knex;
  var User    = Bookshelf.Model.extend({
    tableName: "users",
    hasTimestamps: true,
    idAttrs: ["email"],

    validations: {
      email: ['required', 'email', function(email) {
        var _this = this.target;
        return User.forge({email: email}).fetch().then(function(user) {
          // Only throw if the user is different than the current user.
          if (user && user.id != _this.id) {
            throw new Error("Email already registered");
          }
        });
      }],
      name: ['required'],
      password: ['required', 'minLength:6']
    },

    initialize: function () {
      this.on("created", this.createDefaultProject);
      this.on('saving', this.validate, this);
      this.on('saving', this.hashPassword, this);
    },

    createDefaultProject: function() {
      return app.Models.Project.forge({ownerId: this.id, name: 'Sandbox', description: 'Sandbox'})
      .save()
    },

    hashPassword: function(model) {
      return encryptPassword(model.get('password'))
        .then(function(hash) {
          return model.set({ password: hash });
        })
    },

    projects: function(id) {
      return this.hasMany(app.Models.Project, 'owner_id')
    },

    notebooks: function(id) {
      return this.hasMany(app.Models.Notebook)
    },

    subscriptions: function() {
      return this.hasMany(app.Models.Subscription);
    },

    publications: function() {
      return this.hasMany(app.Models.Publication, 'user_id').through(app.Models.Notebook, 'notebook_id');
    },

    beakerClaim: function() {
      return this.hasOne(app.Models.BeakerClaim, 'user_id')
    },

    gravatar: function() {
      var email = this.get('email');

      // If a user does not have an email yet
      // default to an empty string.
      email = email ? email.trim().toLowerCase() : "";

      var hash = Crypto.createHash('md5').update(email).digest('hex');
      return 'http://www.gravatar.com/avatar/' + hash + '?d=retro';
    },

    addSubscription: function(indexName, dataSetId) {
      return app.Models.Subscription.forge({
        indexName: indexName,
        dataSetId: dataSetId,
        userId: this.id
      }).save()
    },

    removeSubscription: function(indexName, dataSetId) {
      return app.Models.Subscription.forge({
        indexName: indexName,
        dataSetId: dataSetId,
        userId: this.id
      })
      .fetch()
      .then(function(subscription) {
        return subscription.destroy();
      })
    },

    subscriptionsWithDatasets: function() {
      return this.subscriptions()
      .fetch()
      .then(function(subscriptions) {
        var ids = _.invoke(subscriptions.models, 'get', 'dataSetId');
        return app.Models.DataSet.findByIds({ids: ids, index: '*'})
        .then(function(datasets) {
          // inject datasets into subscriptions
          return _.map(subscriptions.toJSON(), function(s) {
            var dataSet = _.findWhere(datasets,
                                      {id: s.dataSetId, index: s.indexName});
            return _.extend(s, {dataSet: dataSet});
          })
        })
      })
    },

    validate: function (model, attrs, options) {
      return new Checkit(this.validations).run(this.attributes);
    },

    update: function(attrs) {
      var _this = this;
      return User.forge({email: this.attributes.email}).fetch()
        .then(function(user) {
          return Bcrypt.compareAsync(attrs.currentPassword, user.attributes.password)
            .then(function(match) {
              if (!match) { throw new Error('Wrong Password')}
              var password = attrs.newPassword ? attrs.newPassword : attrs.currentPassword;
              attrs = _.omit(attrs, 'currentPassword', 'newPassword');
              _.extend(attrs, { password: password })
              return _this.save(attrs);
            })
        })
    }
  });

  User = _.extend(User, {
    findOneWhere: function(attrs) {
      return User.forge(attrs)
      .fetch()
    },

    signUp: function(attrs) {
      return new User(attrs).save()
    },

    signIn: function(attrs) {
      var userEmail = _.pick(attrs, "email");

      return User.forge(userEmail).fetch()
        .then(function(user) {
          if(!user) { throw new Error("Email not registered"); }
          return Bcrypt.compareAsync(attrs.password, user.attributes.password)
            .then(function(match) {
              if(!match) { throw new Error('Wrong password'); }
              return user;
            });
        });
    },

    changePassword: function(attrs) {
      function isExpired(rpr) {
        return moment().utc().diff(moment(new Date(rpr.get('createdAt'))).utc(), 'hours') >=24;
      };

      return app.Models.ForgotPasswordRequests.forge({requestId: attrs.requestId})
      .fetch()
      .then(function(resetPasswordRequest) {
        if (!resetPasswordRequest) {
          throw new PasswordResetException('Password link is invalid or has already been used');
        } else if (isExpired(resetPasswordRequest)) {
          resetPasswordRequest.destroy();
          throw new PasswordResetException('Sorry your request has expired');
        } else {
          return User.forge({id: resetPasswordRequest.get('userId')}).fetch()
            .then(function(user) {
              return user.save({password: attrs.password})
                .then(function() {
                  return resetPasswordRequest.destroy();
                })
            })
        }
      })
    }
  });

  return {
    name: "User",
    model: User
  };
};
