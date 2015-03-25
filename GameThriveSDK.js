/**
 * Modified MIT License
 * 
 * Copyright 2015 GameThrive
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * 1. The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * 2. All copies of substantial portions of the Software may only be used in connection
 * with services provided by GameThrive.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
 
// Requires Chrome version 42+

var GameThrive = {
  _VERSION: 9000,
  _HOST_URL: "https://gamethrive.com/api/v1/",
  
  _GT_app_id: null,
  
  _tagsToSendOnRegister: null,
  
  _notificationOpened_callback: null,
  _idsAvailable_callback: null,
  
  _defaultLaunchURL: null,
  
  _gt_db: null,

  _init_options: null,
  
  LOGGING: false,

  _log: function(message) {
    if (GameThrive.LOGGING == true)
      console.log(message);
  },
  
  _init_gt_db: function(callback) {
    if (GameThrive._gt_db) {
      callback();
      return;
    }
    
    var request = indexedDB.open("GAMETHRIVE_SDK_DB", 1);
    request.onsuccess = function(event) {
      GameThrive._gt_db = event.target.result;
      callback();
    };
    
    request.onupgradeneeded = function(event) { 
      var db = event.target.result;
      
      db.createObjectStore("Ids", { keyPath: "type" });
      db.createObjectStore("NotificationOpened", { keyPath: "url" });
      db.createObjectStore("Options", { keyPath: "key" });
    };
  },
  
  _get_db_value(table, key, callback) {
    GameThrive._init_gt_db(function() {
      GameThrive._gt_db.transaction(table).objectStore(table).get(key).onsuccess = callback;
    });
  },
  
  _put_db_value(table, value) {
    GameThrive._init_gt_db(function() {
      GameThrive._gt_db.transaction([table], "readwrite").objectStore(table).put(value);
    });
  },
  
  _delete_db_value(table, key) {
    GameThrive._init_gt_db(function() {
      GameThrive._gt_db.transaction([table], "readwrite").objectStore(table).delete(key);
    });
  },
  
  _sendToGameThriveApi: function(url, action, inData, callback) {
    var contents = {
      method: action,
      //mode: 'no-cors', // no-cors is disabled for non-serviceworker.
    };
    
    if (inData) {
      contents.headers = {"Content-type": "application/json;charset=UTF-8"};
      contents.body = JSON.stringify(inData);
    }
    
    fetch(GameThrive._HOST_URL + url, contents)
    .then(function status(response) {
      if (response.status >= 200 && response.status < 300)
        return Promise.resolve(response);
      else
        return Promise.reject(new Error(response.statusText));
    })
    .then(function status(response) { return response.json(); } )
    .then(function (jsonData) {
      GameThrive._log(jsonData);
      if (callback != null)
        callback(jsonData);
    })
    .catch(function (error) {
      GameThrive._log('Request failed', error);
    });
  },
  
  _getLanguage: function() {
    return navigator.language ? (navigator.language.length > 3 ? navigator.language.substring(0, 2) : navigator.language) : 'en';
  },
  
  _getPlayerId: function(value, callback) {
    if (value)
      callback(value)
    else {
      GameThrive._get_db_value("Ids", "playerId", function(event) {
        if (event.target.result)
          callback(event.target.result.id);
      });
    }
  },
  
  _registerWithGameThrive: function(appId, registrationId) {
    GameThrive._get_db_value("Ids", "playerId", function(event) {
      var requestUrl = 'players';
      if (event.target.result)
        requestUrl = 'players/' + event.target.result.id + '/on_session';
      
      var jsonData = {app_id: appId,
                      device_type: 5,
                      language: GameThrive._getLanguage(),
                      timezone: new Date().getTimezoneOffset() * -60,
                      device_model: navigator.platform + " Chrome",
                      device_os: navigator.appVersion.match(/Chrome\/(.*?) /)[1],
                      sdk: GameThrive._VERSION};
      
      if (registrationId) {
        jsonData.identifier = registrationId;
        GameThrive._put_db_value("Ids", {type: "registrationId", id: registrationId});
      }
      
      GameThrive._sendToGameThriveApi(requestUrl, 'POST', jsonData,
        function registeredCallback(responseJSON) {
          if (responseJSON.id)
            GameThrive._put_db_value("Ids", {type: "playerId", id: responseJSON.id});
          
          if (GameThrive._idsAvailable_callback) {
            GameThrive._getPlayerId(responseJSON.id, function(playerId) {
              GameThrive._idsAvailable_callback({playerId: playerId, registrationId: registrationId});
              GameThrive._idsAvailable_callback = null;
            });
          }
        }
      );
    });
  },
  
  setDefaultNotificationUrl: function(url) {
    GameThrive._put_db_value("Options", {key: "defaultUrl", value: url});
  },
  
  setDefaultIcon: function(icon) {
    GameThrive._put_db_value("Options", {key: "defaultIcon", value: icon});
  },
  
  setDefaultTitle: function(title) {
    GameThrive._put_db_value("Options", {key: "defaultTitle", value: title});
  },
  
  _visibilitychange: function() {
    if (document.visibilityState == "visible") {
      document.removeEventListener("visibilitychange", GameThrive._visibilitychange);
      GameThrive._sessionInit();
    }
  },
  
  init: function(options) {
    GameThrive._init_options = options;
    
    window.addEventListener('load', function() {   
      GameThrive._get_db_value("Ids", "registrationId", function(event) {
        if (sessionStorage.getItem("GT_SESSION"))
          return;
        
        sessionStorage.setItem("GT_SESSION", true);
        
        if (GameThrive._init_options.autoRegister == false && !event.target.result)
          return;
        
        if (document.visibilityState != "visible") {
          document.addEventListener("visibilitychange", GameThrive._visibilitychange);
          return;
        }
        
        GameThrive._sessionInit();
      });
    });
  },
  
  registerForPushNotifications() {
    GameThrive._get_db_value("Ids", "registrationId", function(event) { 
      if (!event.target.result)
        GameThrive._sessionInit();
    });
  },
  
  _sessionInit: function() {
    if ('serviceWorker' in navigator && navigator.userAgent.toLowerCase().indexOf('chrome') > -1) {
      GameThrive._GT_app_id = GameThrive._init_options.appId;
      GameThrive._put_db_value("Ids", {type: "appId", id: GameThrive._GT_app_id});
      GameThrive._put_db_value("Options", {key: "pageTitle", value: document.title});
      
      navigator.serviceWorker.getRegistration().then(function (event) {
        if (typeof event === "undefined") // Nothing registered, very first run
          navigator.serviceWorker.register('GameThriveSDKWorker.js').then(GameThrive._enableNotifications, GameThrive._registerError);
        else {
          if (event.active) {
            if (event.active.scriptURL.indexOf("GameThriveSDKWorker.js") > -1) {
              GameThrive._get_db_value("Ids", "WORKER1_GT_SW_VERSION", function(gtVersion) {
                if (gtVersion.target.result) {
                  if (gtVersion.target.result.id != GameThrive._VERSION) {
                    event.unregister().then(function () {
                      navigator.serviceWorker.register('GameThriveSDKUpdaterWorker.js').then(GameThrive._enableNotifications, GameThrive._registerError);
                    });
                  }
                  else
                    navigator.serviceWorker.register('GameThriveSDKWorker.js').then(GameThrive._enableNotifications, GameThrive._registerError);
                }
                else
                  navigator.serviceWorker.register('GameThriveSDKWorker.js').then(GameThrive._enableNotifications, GameThrive._registerError);
              });
            }
            else if (event.active.scriptURL.indexOf("GameThriveSDKUpdaterWorker.js") > -1) {
              GameThrive._get_db_value("Ids", "WORKER2_GT_SW_VERSION", function(gtVersion) {
                if (gtVersion.target.result) {
                  if (gtVersion.target.result.id != GameThrive._VERSION) {
                    event.unregister().then(function () {
                      navigator.serviceWorker.register('GameThriveSDKWorker.js').then(GameThrive._enableNotifications, GameThrive._registerError);
                    });
                  }
                  else
                    navigator.serviceWorker.register('GameThriveSDKUpdaterWorker.js').then(GameThrive._enableNotifications, GameThrive._registerError);
                }
                else
                    navigator.serviceWorker.register('GameThriveSDKUpdaterWorker.js').then(GameThrive._enableNotifications, GameThrive._registerError);
              });
            }
          }
          else if (event.installing == null)
            navigator.serviceWorker.register('GameThriveSDKWorker.js').then(GameThrive._enableNotifications, GameThrive._registerError);
        }
      }).catch(function (error) {
        GameThrive._log("ERROR Getting registration: " + error);
      });
    }
    else
      GameThrive._log('Service workers are not supported in this browser.');
  },
  
  _registerError: function(err) {
    GameThrive._log("navigator.serviceWorker.register:ERROR: " + err);
  },
  
  _enableNotifications: function(existingServiceWorkerRegistration) { // is ServiceWorkerRegistration type    
    if (!('PushManager' in window)) {
      GameThrive._log("Push messaging is not supported.");
      return;
    }
    
    if (!('showNotification' in ServiceWorkerRegistration.prototype)) {  
      GameThrive._log("Notifications are not supported.");
      return;
    }
    
    if (Notification.permission === 'denied') {
      GameThrive._log("The user has disabled notifications.");
      return;
    }
    
    navigator.serviceWorker.ready.then(function(serviceWorkerRegistration) {
      serviceWorkerRegistration.pushManager.subscribe()
      .then(function(subscription) {
        var registrationId = null;
        if (subscription) {
          registrationId = subscription.subscriptionId;
          GameThrive._log('registration id is:' + registrationId);
        }
        else
          GameThrive._log('Error could not subscribe to GCM!');
        
        GameThrive._registerWithGameThrive(GameThrive._GT_app_id, registrationId);
      })
      .catch(function(err) {
        GameThrive._log('Error during subscribe()');
        GameThrive._log(err);
      });
    });
  },
  
  sendTag: function(key, value) {
    jsonKeyValue = {};
    jsonKeyValue[key] = value;
    GameThrive.sendTags(jsonKeyValue);
  },
  
  sendTags: function(jsonPair) {
    GameThrive._get_db_value("Ids", "playerId", function(event) {
      if (event.target.result)
        GameThrive._sendToGameThriveApi("players/" + event.target.result.id, "PUT", {app_id: GameThrive._GT_app_id, tags: jsonPair});
      else {
        if (GameThrive._tagsToSendOnRegister == null)
          GameThrive._tagsToSendOnRegister = jsonPair;
        else
          GameThrive._tagsToSendOnRegister = GameThrive._tagsToSendOnRegister.concat(jsonPair);
      }
    });
  },
  
  deleteTag: function(key) {
    GameThrive.deleteTags([key]);
  },
  
  deleteTags: function(keyArray) {
    var jsonPair = {};
    var length = keyArray.length;
    for (var i = 0; i < length; i++)
      jsonPair[keyArray[i]] = "";
    
    GameThrive.sendTags(jsonPair);
  },
  
  _handleNotificationOpened: function(event) {
    var notificationData = JSON.parse(event.notification.tag);
    event.notification.close();
    
    GameThrive._get_db_value("Ids", "appId", function(appIdEvent) {
      if (appIdEvent.target.result) {
        GameThrive._get_db_value("Ids", "playerId", function(playerIdEvent) {
          if (playerIdEvent.target.result) {
            GameThrive._sendToGameThriveApi("notifications/" + notificationData.id, "PUT",
              {app_id: appIdEvent.target.result.id, player_id: playerIdEvent.target.result.id, opened: true});
          }
        });
      }
    });
    
    event.waitUntil(
      clients.matchAll({type: "window"})
      .then(function(clientList) {
        var launchURL = registration.scope;
        if (GameThrive._defaultLaunchURL)
          launchURL = GameThrive._defaultLaunchURL;
        if (notificationData.launchURL)
          launchURL = notificationData.launchURL;
        
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client && client.url == launchURL) {
            client.focus();
            
            // Seems to only work if we leave off the targetOrigin param.
            client.postMessage(notificationData);
            return;
          }
        }
        
        GameThrive._put_db_value("NotificationOpened", {url: launchURL, data: notificationData});
        clients.openWindow(launchURL);
      })
    );
  },
  
  _getTitle: function(incomingTitle, callback) {
    if (incomingTitle != null) {
      callback(incomingTitle);
      return;
    }
    
    GameThrive._get_db_value("Options", "defaultTitle", function(event) {
      if (event.target.result) {
        callback(event.target.result.value);
        return;
      }
      
      GameThrive._get_db_value("Options", "pageTitle", function(event) {
        if (event.target.result && event.target.result.value != null) {
          callback(event.target.result.value);
          return;
        }
        
        callback("");
      });
    });
  },
  
  _handleGCMMessage(serviceWorker, event) {
    // TODO: Read data from the GCM payload when Chrome no longer requires the below command line parameter.
    // --enable-push-message-payload
    // The command line param is required even on Chrome 43 nightly build 2015/03/17.
    if (event.data && event.data.text()[0] == "{") {
      GameThrive._log('Received data.text: ', event.data.text());
      GameThrive._log('Received data.json: ', event.data.json());
    }
    
    GameThrive._getLastNotification(function(response, appId) {
      var notificationData = {
        id: response.custom.i,
        message: response.alert,
        additionalData: response.custom.a
      };
      
      if (response.custom.u)
        notificationData.launchURL = response.custom.u;
      
      GameThrive._getTitle(response.title, function(title) {
        notificationData.title = title;
        GameThrive._get_db_value("Options", "defaultIcon", function(event) {
          var icon = null;
          if (event.target.result)
            icon = event.target.result.value;
          
          if (response.icon) {
            icon = response.icon;
            notificationData.icon = response.icon;
          }
          
          serviceWorker.registration.showNotification(title, {
            body: response.alert,
            icon: icon,
            tag: JSON.stringify(notificationData)
          });
        });
      });
      
      GameThrive._get_db_value("Options", "defaultUrl", function(event) {
        if (event.target.result)
          GameThrive._defaultLaunchURL = event.target.result.value;
      });
    });
  },
  
  _getLastNotification: function(callback) {
    GameThrive._get_db_value("Ids", "appId", function(event) {
      if (event.target.result) {
        GameThrive._sendToGameThriveApi("apps/" + event.target.result.id + "/last_chromeweb_notification?language=" + GameThrive._getLanguage(), "GET", null, function(response) {
          callback(response);
        });
      }
      else
        GameThrive._log("Error: could not get notificationId");
    });
  },
  
  _listener_receiveMessage: function receiveMessage(event) {
    if (event.origin !== "")
      return;
    
    if (GameThrive._notificationOpened_callback)
      GameThrive._notificationOpened_callback(event.data);
  },
  
  addListenerForNotificationOpened: function(callback) {
    GameThrive._notificationOpened_callback = callback;
    if (window) {
      GameThrive._get_db_value("NotificationOpened", document.URL, function(value) {
        if (value.target.result) {
          GameThrive._delete_db_value("NotificationOpened", document.URL);
          GameThrive._notificationOpened_callback(value.target.result.data);
        }
      });
    }
  },
  
  getIdsAvailable: function(callback) {
    GameThrive._idsAvailable_callback = callback;
    
    GameThrive._get_db_value("Ids", "playerId", function(playerIdEvent) {
      if (playerIdEvent.target.result) {
        GameThrive._get_db_value("Ids", "registrationId", function(registrationIdEvent) {
          if (registrationIdEvent.target.result) {
            callback({playerId: playerIdEvent.target.result.id, registrationId: registrationIdEvent.target.result.id});
            GameThrive._idsAvailable_callback = null;
          }
          else
            callback({playerId: playerIdEvent.target.result.id, registrationId: null});
        });
      }
    });
  },
  
  getTags: function(callback) {
    GameThrive._get_db_value("Ids", "playerId", function(playerIdEvent) {
      if (playerIdEvent.target.result) {
        GameThrive._sendToGameThriveApi("players/" + playerIdEvent.target.result.id, 'GET', null, function(response) {
          callback(response.tags);
        });
      }
    });
  }
};

// If imported on your page.
if (typeof  window !== "undefined")
  window.addEventListener("message", GameThrive._listener_receiveMessage, false);
else { // if imported from the service worker.
  self.addEventListener('push', function(event) {
    GameThrive._handleGCMMessage(self, event);
  });
  self.addEventListener('notificationclick', function(event) {
    GameThrive._handleNotificationOpened(event);
  });
  self.addEventListener('install', function(event) {
    GameThrive._log("GameThrive Installed service worker: " + GameThrive._VERSION);
    if (self.location.pathname.indexOf("GameThriveSDKWorker.js") > -1)
      GameThrive._put_db_value("Ids", {type: "WORKER1_GT_SW_VERSION", id: GameThrive._VERSION});
    else
      GameThrive._put_db_value("Ids", {type: "WORKER2_GT_SW_VERSION", id: GameThrive._VERSION});
  });
}