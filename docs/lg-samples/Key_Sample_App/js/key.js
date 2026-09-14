
/*
 *  Copyright (c) 2020 The LG Electronics. All Rights Reserved.
 *  Pro:Centric Smart TV/STB Sample Code - Key Mapping
 */

var Key = {
    'Number1': hcap.key.Code.NUM_1,
    'Number2': hcap.key.Code.NUM_2,
    'Number3': hcap.key.Code.NUM_3,
    'Number4': hcap.key.Code.NUM_4,
    'Number5': hcap.key.Code.NUM_5,
    'Number6': hcap.key.Code.NUM_6,
    'Number7': hcap.key.Code.NUM_7,
    'Number8': hcap.key.Code.NUM_8,
    'Number9': hcap.key.Code.NUM_9,
    'Number0': hcap.key.Code.NUM_0,
    'Up': hcap.key.Code.UP,
    'Left': hcap.key.Code.LEFT,
    'OK': hcap.key.Code.ENTER,
    'Right': hcap.key.Code.RIGHT,
    'Down': hcap.key.Code.DOWN,
    'Power': hcap.key.Code.POWER,
    'ChannelUp': hcap.key.Code.CH_UP,
    'ChannelDown': hcap.key.Code.CH_DOWN,
    'Red': hcap.key.Code.RED,
    'Green': hcap.key.Code.GREEN,
    'Yellow': hcap.key.Code.YELLOW,
    'Blue': hcap.key.Code.BLUE,
    'Rewind': hcap.key.Code.REWIND,
    'Play': hcap.key.Code.PLAY,
    'Pause': hcap.key.Code.PAUSE,
    'Forward': hcap.key.Code.FAST_FORWARD,
    'Stop': hcap.key.Code.STOP,
    'Back': hcap.key.Code.BACK,
    'Menu': hcap.key.Code.MENU,
    'Home': hcap.key.Code.PORTAL,
    'Exit': hcap.key.Code.EXIT,
    'Guide': hcap.key.Code.GUIDE,
    'TV': hcap.key.Code.TV,
    'Info': hcap.key.Code.INFO,
    'Opt': hcap.key.Code.T_OPT,
    'Text': hcap.key.Code.TEXT,
    'Power': hcap.key.Code.POWER,
    'Portal': hcap.key.Code.PORTAL
}

function setVolumeLevel(level) {
    hcap.volume.setVolumeLevel({
        "level": level,
        "onSuccess": function () {
            log("onSuccess to set volume level : 50");
            hideShow("setVolumeSuccess", "inline");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("setVolumeFail","inline");
        }
    });
}

function getNetworkInfo() {
    hcap.network.getNetworkInformation({
        "onSuccess": function (s) {
            log("-------------------------------");
            log("[ Success to get network info ]");
            log("#network_mode = " + s.network_mode);
            log("#ip_address = " + s.ip_address);
            log("#subnet_mask = " + s.subnet_mask);
            log("#gateway = " + s.gateway);
            log("#dns1_address = " + s.dns1_address);

            hideShow("getNetworkInfoSuccess", "inline");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("getNetworkInfoFail", "inline");
        }
    });
}

var previous_att = [1,1,1,1,1];
hcap.key.clearKeyTable({
    "onSuccess" : function() {
        console.log("onSuccess");
    }, 
    "onFailure" : function(f) {
        console.log("onFailure : errorMessage = " + f.errorMessage);
    }
});

//Toggle attrebute of hcap.key.addKeyItem
function set_key_table(virtualKeycode) { 
    var vkey, attribute;
    switch (virtualKeycode) {
        case 1:vkey = Key.Number1; break;
        case 2:vkey = Key.Number2; break;
        case 3:vkey = Key.Number3; break;
        case 4:vkey = Key.Number4; break;
        default:vkey = Key.Number4; break;
    }

    if(previous_att[virtualKeycode] === 0)
    {
        log(virtualKeycode + " key attribute = 2");
        previous_att[virtualKeycode] = attribute = 2;
    }    
    else
    {
        log(virtualKeycode + " key attribute = 0");
        previous_att[virtualKeycode] = attribute = 0;
    } 

        hcap.key.addKeyItem({
        "keycode" : 0,
        "virtualKeycode" : vkey,
        "attribute" : attribute,
        "onSuccess" : function() {
            log("onSuccess");
        }, 
        "onFailure" : function(f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
        });
}

//Key event listener
document.addEventListener("keydown", onKeyDown , true);
function onKeyDown(event) {
    log('event.keyCode : ' + event.keyCode);
    switch (event.keyCode) {
        case Key.Number0:
            clearLogMsg();
            hcap.key.clearKeyTable({
                "onSuccess" : function() {
                    log("clearKeyTable onSuccess");
                }, 
                "onFailure" : function(f) {
                    log("clearKeyTable onFailure : errorMessage = " + f.errorMessage);
                }
            });
            break;
        case Key.Number1:
            setVolumeLevel(50);                                 //set Volume Level
            break;
        case Key.Number2:
            getNetworkInfo();                                   //get network info
            break;
        case Key.Number5: set_key_table(1);break;
        case Key.Number6: set_key_table(2);break;
        case Key.Portal:
            window.location.href = "";                          //restart app
            break;
        default:
            break;
    }
}


