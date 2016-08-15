var Component = require("montage/ui/component").Component,
    Model = require("core/model/model").Model,
    Promise = require("montage/core/promise").Promise,
    Converter = require("montage/core/converter/converter").Converter,
    Validator = require("montage/core/converter/converter").Validator;

/**
 * @class User
 * @extends Component
 */
exports.User = Component.specialize({

    shellOptions: {
        value: null
    },

    userType: {
        value: null
    },

    _object: {
        value: null
    },

    object: {
        get: function () {
            return this._object;
        },
        set: function (object) {
            if (this._object != object) {
                this._object = object;
                this._loadGroups(object);
                if (typeof object.uid != 'number') {
                    this._getNextAvailableUserId();
                }
                this._openHomeDirectory();
            }
        }
    },

    additionalGroups: {
        value: null
    },

    groupOptions: {
        value: null
    },

    enterDocument: {
        value: function(isFirstTime) {
            var self = this,
                loadingPromises = [],
                shell;
            this.isLoading = true;
            loadingPromises.push(this._openHomeDirectory());
            if (isFirstTime) {
                loadingPromises.push(this._getShellOptions());
            }
            this.userType = this.object.builtin && this.object.uid !== 0 ? "system" : "user";
            Promise.all(loadingPromises).then(function() {
                self.isLoading = false;
            });
        }
    },

    exitDocument: {
        value: function() {
            this.userType = null;
        }
    },

    save: {
        value: function() {
            this.object.groups = this.additionalGroups.map(function(x) { return x.id; });
            return this.application.dataService.saveDataObject(this.object);
        }
    },

    revert: {
        value: function() {
            var self = this;
            return this.inspector.revert().then(function() {
                if (self._object._isNew) {
                    self._getNextAvailableUserId();
                }
                self._object.password = null;
                return self._openHomeDirectory();
            });
        }
    },

    _openHomeDirectory: {
        value: function() {
            if (this.treeController) {
                var self = this;
                return this.treeController.open(this._object.home).then(function() {
                    return self._object.home = self.treeController.selectedPath;
                });
            }
        }
    },

    _loadGroups: {
        value: function() {
            var self = this;
            this.application.dataService.fetchData(Model.Group).then(function (groups) {
                self.groupOptions = groups;
                self.additionalGroups = self._object.groups ? groups.filter(function (x) { return self.object.groups.indexOf(x.id) > -1; }) : [];
            });
        }
    },

    _getNextAvailableUserId: {
        value: function() {
            var self = this;
            return Model.populateObjectPrototypeForType(Model.User).then(function (User) {
                return User.constructor.services.nextUid();
            }).then(function(userId) {
                self.nextUserId = self.object.uid = userId;
            });
        }
    },

    _getShellOptions: {
        value: function() {
            var self = this;
            this.shellOptions = [];
            return this.application.accountsService.getShells().then(function(shells){
                for (var i=0, length=shells.length; i<length; i++) {
                    shell = shells[i].split("/");
                    self.shellOptions.push({label: shell[shell.length -1], value: shells[i]});
                }
            });
        }
    }
});

exports.AdditionalGroupsConverter = Converter.specialize({
    convert: {
        value: function (groupId) {
            return this.groupOptions.find(function(x){ return x.id === groupId; });
        }
    },

    revert: {
        value: function (name) {
            var newGroupValue = this.groupOptions.find(function(x) { return x.name === name; });
            return newGroupValue ? newGroupValue.id : null;
        }
    }
});

exports.AdditionalGroupsValidator = Validator.specialize({
    validate: {
        value: function (name) {
            return !!this.groupOptions.find(function(x) { return x.name === name; });
        }
    }
});
