/*
 *  Copyright (c) 2020 The LG Electronics. All Rights Reserved.
*/

var date = new Date();

function run() {
    window.setTimeout("initialize()", 2000);
}

function initialize() {
    try {
        document.addEventListener("keydown", onKeyDown , true);
        setDebugMode();
        setChannelFloatingUI();
        log("initialize completed!");
    }
    catch (e) {
        log("Initialize Error: " + e.message);
    }
    if(typeof(EventSource) !== "undefined") {
        // Yes! Server-sent events support!
        // Some code.....
        log("Yes! Server-sent events support!");
      } else {
        // Sorry! No server-sent events support..
        log("Sorry! No server-sent events support..");
      }
}

function log(msg) {
    var logArea = document.getElementById('log_area');
    logArea.innerHTML += ('[' + getTimeStamp() + '] ' + msg + '<br/>');
}

function clearLogMsg() {
    var logArea = document.getElementById('log_area');
    logArea.innerHTML = "Log Messages Clear<br>";
}

function setDebugMode() {
    idcap.request( "idcap://configuration/property/set" , {
        "parameters": {
            "key" : "browser_debug_mode",
            "value" : "1"
        },
        "onSuccess": function () {
            log("#Success to set browser debug mode");
        },
        "onFailure": function (f) {
            log("#Fail to set browser debug mode(errorMessage = " + f.errorMessage + ")");
        }
    });
}

function setChannelFloatingUI() {
    idcap.request( "idcap://configuration/property/set" , {
        "parameters": {
            "key" : "tv_channel_attribute_floating_ui",
            "value" : "0"
        },
        "onSuccess": function () {
            log("#Success to set Channel Floating UI");
        },
        "onFailure": function (f) {
            log("#Fail to set Channel Floating UI(errorMessage = " + f.errorMessage + ")");
        }
    });
}

function getTimeStamp() {
    var result = ("0" + (date.getMonth() + 1)).slice(-2) + '-' +
        ("0" + date.getDate()).slice(-2) + ' ' +
        ("0" + date.getHours()).slice(-2) + ':' +
        ("0" + date.getMinutes()).slice(-2) + ':' +
        ("0" + date.getSeconds()).slice(-2);
    return result;
}

function reboot() {
	idcap.request( "idcap://power/command" , {
        "parameters": {
            "powerCommand" : "reboot"
        },
        "onSuccess": function () {
            console.log("Success to reboot");
        },
        "onFailure": function (err) {
            console.log("Fail to reboot : " + err.errorMessage);
        }
    });
}

function hideShow(element, status){
    document.getElementById(element).style.display = status;
} 