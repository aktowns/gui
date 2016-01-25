/*global require, exports, Error*/
var Target = require("montage/core/target").Target,
    WebSocketClient = require("core/backend/websocket-client").WebSocketClient,
    WebSocketMessage = require("core/backend/websocket-message").WebSocketMessage,
    WebSocketResponse = require("core/backend/websocket-response").WebSocketResponse,
    WebSocketConfiguration = require("core/backend/websocket-configuration").WebSocketConfiguration,
    HandlerPool = require("core/backend/handler-pool").HandlerPool;


var RPC_NAME_SPACE = "rpc",
    EVENTS_NAME_SPACE = "events",
    EVENT_NAME = "event",
    RESPONSE_NAME = "response";


var EventTypeMap = Object.create(null);


/**
 * @class
 * @extends Target
 *
 * @description Object used as a bridge to the backend.
 *
 */
exports.BackEndBridge = Target.specialize({


    /*------------------------------------------------------------------------------------------------------------------
                                                    Public Functions
     -----------------------------------------------------------------------------------------------------------------*/


    /**
     * @constructor
     * @public
     *
     * @description todo
     *
     */
    constructor: {
        value: function BackEndBridge () {
            this._connection = new WebSocketClient().initWithUrl(WebSocketConfiguration.WEB_SOCKET_URL);
            this._handlerPool = new HandlerPool().initWithHandlerTimeout(WebSocketConfiguration.WEB_SOCKET_SEND_MESSAGE_TIMEOUT);
            this._connection.delegate = this;
            this._connection.responseType = WebSocketClient.RESPONSE_TYPE.JSON;
            this._connection.addEventListener("webSocketMessage", this);
        }
    },


    /**
     * @function
     * @public
     *
     * @description Try to establish a connection to the server.
     *
     * @returns {Promise}
     *
     */
    connect: {
        value: function () {
            return this._connection.connect();
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @returns {Promise}
     *
     */
    reConnect: {
        value: function () {
            this._handlerPool.clear();

            return this._connection.reConnect();
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @params {Number} code.
     * @params {String} reason.
     *
     */
    disconnect: {
        value: function (code, reason) {
            this._handlerPool.clear();

            this._connection.disconnect(code, reason);
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @params {Object.<WebSocketClient>} webSocket.
     * @params {String} message.
     *
     */
    webSocketWillSendMessage: {
        value: function (webSocket, message) {
            var handler = this._handlerPool.findHandler(message.id);

            if (handler) {
                this._handlerPool.setTimeoutToHandler(handler);
            }

            return message.toJSON();
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @param {Event} event.
     *
     */
    handleWebSocketMessage: {
        value: function (event) {
            var response = event.detail;

            if (response) {
                if (response.namespace === RPC_NAME_SPACE && response.id) {
                    // try to find a deferred promise that will handle this message according to its UID.
                    var deferred = this._handlerPool.releaseHandler(response.id);

                    if (deferred) {
                        if (response.name === RESPONSE_NAME) {
                            deferred.resolve(new WebSocketResponse(response));

                        } else if (response.name === "error") {
                            /**
                             * FIXME: Need to investigate, it seems that code errors are the same
                             * when an user is not logged or gives wrong credentials...
                             */
                            if (response.args.code === 13) {
                                if (response.args.message === "Not logged in") {
                                    this.dispatchEventNamed("userDisconnected", true, true);
                                }

                                deferred.reject(response.args);

                            } else {
                                deferred.reject("Error Server received, code: " +
                                    response.args.code + " , message: " + response.args.message);
                            }
                        } else {
                            deferred.reject("Unknown message received", response);
                        }
                    } else {
                        console.warn("Message received but no handler has been found");
                    }
                } else if (response.namespace === EVENTS_NAME_SPACE) {
                    this.dispatchEventNamed(this._getEventTypeFromRawType(
                        response.name !== EVENT_NAME ? response.name : response.args.name),
                        true,
                        true,
                        response.args.args || response.args);
                }
            }
        }
    },


    /**
     * @function
     * @public
     *
     * @description Sends a message.
     *
     * @param {Object.<WebSocketMessage>} message.
     *
     * @returns {Promise}
     *
     */
    sendMessage: {
        value: function (message) {
            if (message instanceof WebSocketMessage) {
                if (message.namespace === RPC_NAME_SPACE) {
                    var self = this;

                    return new Promise(function (resolve, reject) {
                        message.id = self._handlerPool.addHandler({
                            resolve: resolve,
                            reject: reject
                        });

                        self._connection.sendMessage(message);
                    });

                } else {
                    return Promise.resolve(this._connection.sendMessage(message));
                }
            }

            return Promise.reject(new Error("message must be an WebSocketMessage"));
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @params {String} namespace
     * @params {String} name
     * @params {Array} args
     *
     * @returns {Promise}
     *
     */
    send: {
        value: function (namespace, name, args) {
            return this.sendMessage(new WebSocketMessage(namespace, name, args));
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @params {String} event
     * @params {Object} listener
     * @params {Boolean} useCapture
     *
     */
    subscribeToEvent: {
        value: function (event, listener, useCapture) {
            this.subscribeToEvents([event], listener, useCapture);
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @params {Array.<String>} events
     * @params {Object} listener
     * @params {Boolean} useCapture
     *
     */
    subscribeToEvents: {
        value: function (events, listener, useCapture) {
            if (this._checkEventsValidity(events)) {
                this.send(EVENTS_NAME_SPACE, "subscribe", events);
                this._addEventListeners(events, listener, useCapture);
            }
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @params {String} event
     * @params {Object} listener
     * @params {Boolean} useCapture
     *
     */
    unSubscribeToEvent: {
        value: function (event, listener, useCapture) {
            this.unSubscribeToEvents([event], listener, useCapture);
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @params {Array.<String>} events
     * @params {Object} listener
     * @params {Boolean} useCapture
     *
     */
    unSubscribeToEvents: {
        value: function (events, listener, useCapture) {
            if (this._checkEventsValidity(events)) {
                this.send(EVENTS_NAME_SPACE, "unsubscribe", events);
                this._removeEventListeners(events, listener, useCapture);
            }
        }
    },


    /**
     * @function
     * @public
     *
     * @description todo
     *
     * @param {Array} args.
     *
     * @returns {Promise}
     *
     */
    submitTask: {
        value: function (args) {
            return this.send(RPC_NAME_SPACE, "call", {
                method: "task.submit",
                args: args
            });
        }
    },


    /*------------------------------------------------------------------------------------------------------------------
                                                    Private Functions
     -----------------------------------------------------------------------------------------------------------------*/


    /**
     * @function
     * @private
     *
     * @description todo
     *
     * @params {events} events
     *
     */
    _checkEventsValidity: {
        value: function (events) {
            var isValid = events && events.constructor === Array;

            if (isValid) {
                for (var i = 0, length = events.length; i < length && isValid === true; i++) {
                    var event = events[i];
                    isValid = typeof event === "string" && !!event.length;
                }
            }

            return isValid;
        }
    },


    /**
     * @function
     * @private
     *
     * @description todo
     *
     * @params {Array.<String>} events
     * @params {Object} listener
     * @params {Boolean} useCapture
     *
     */
    _addEventListeners: {
        value: function (events, listener, useCapture) {
            if (listener) {
                for (var i  = 0, length = events.length; i < length; i++) {
                    this.addEventListener(this._getEventTypeFromRawType(events[i]), listener, useCapture);
                }
            }
        }
    },


    /**
     * @function
     * @private
     *
     * @description todo
     *
     * @params {Array.<String>} events
     * @params {Object} listener
     * @params {Boolean} useCapture
     *
     */
    _removeEventListeners: {
        value: function (events, listener, useCapture) {
            if (listener) {
                for (var i  = 0, length = events.length; i < length; i++) {
                    this.removeEventListener(this._getEventTypeFromRawType(events[i]), listener, useCapture);
                }
            }
        }
    },


    /**
     * @function
     * @private
     *
     * @description todo
     *
     * @params {String} rawType
     *
     */
    _getEventTypeFromRawType: {
        value: function (rawType) {
            if (typeof rawType === "string" && rawType.length) {
                rawType = rawType.trim();

                var eventType = EventTypeMap[rawType];

                if (!eventType) {
                    var data = rawType.split(/\.|_|-/);

                    eventType = data[0];

                    for (var i = 1, length = data.length; i < length; i++) {
                        eventType += data[i].toCapitalized();
                    }

                    EventTypeMap[rawType] = eventType;
                }

                return eventType;

            } else {
                throw new Error("Can't get event type from given type: " + rawType);
            }
        }
    }

});