/*
 *  Copyright (c) 2020 The LG Electronics. All Rights Reserved.
 *  Pro:Centric Smart TV/STB Sample Code - TV Power
 */

function setPowerMode(mode) {
    idcap.request( "idcap://power/powermode/set", {
        "parameters": {
            "mode" : mode
        },
        "onSuccess": function () {
            log("Success to set power mode : "+mode);
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + err.errorMessage);
        }
    });
}

function setInstantMode(mode) {
    idcap.request( "idcap://configuration/property/set" , {
        "parameters": {
            "key" : "instant_power",
            "value" : mode
        },
        "onSuccess": function () {
            log("set Instant Mode " + mode);
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + err.errorMessage);
        }
    });
}

function setWOL(mode) {
    idcap.request( "idcap://configuration/property/set" , {
        "parameters": {
            "key" : "wol_m",
            "value" : mode
        },
        "onSuccess": function () {
            log("set WOL " + mode);
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + err.errorMessage);
        }
    });
}

function Show_current_status()
{
    idcap.request( "idcap://configuration/property/get" , {
        "parameters": {
            "key" : "instant_power"
        },
        "onSuccess": function (cbObject) {
            log("instant_power = " + cbObject.value);
            if(cbObject.value == "0")
                idcap.request( "idcap://configuration/property/get" , {
                    "parameters": {
                        "key" : "wol_m"
                    },
                    "onSuccess": function (cbObject) {
                        log("wol_m = " + JSON.stringify(cbObject));
                    },
                    "onFailure": function (err) {
                        log("onFailure : errorMessage = " + err.errorMessage);
                    }
                });
            else
                log("WOL is disalbed because Instant mode is on");
            
        }, 
        "onFailure" : function(f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
   });

   idcap.request( "idcap://power/powermode/get" , {
        "parameters": {},
        "onSuccess" : function(s) {
            log("power mode " + s.mode);
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + err.errorMessage);
        }
    });
}


function reboot() {
	idcap.request( "idcap://power/command" , {
        "parameters": {
            "powerCommand" : "reboot"
        },
        "onSuccess": function () {
            console.log("reboot onSuccess");
        },
        "onFailure": function (err) {
            console.log("Fail to reboot : " + err.errorMessage);
        }
    });
}

//key values defined for function onKeyDown(event)
idcap.key = {};
idcap.key.Code = {
    NUM_0: 0x0030,  /* Number 0 key.     */
    NUM_1: 0x0031,  /* Number 1 key.     */
    NUM_2: 0x0032,  /* Number 2 key.     */
    NUM_3: 0x0033,  /* Number 3 key.     */
    NUM_4: 0x0034,  /* Number 4 key.     */
    NUM_5: 0x0035,  /* Number 5 key.     */
    NUM_6: 0x0036,  /* Number 6 key.     */
    NUM_7: 0x0037,  /* Number 7 key.     */
    NUM_8: 0x0038,  /* Number 8 key.     */
    NUM_9: 0x0039,  /* Number 9 key.     */
    CH_UP: 0x01AB,  /* Channel up key.     */
    CH_DOWN: 0x01AC,    /* Channel down key.     */
    GUIDE: 0x01CA,  /* Guide key.     */
    INFO: 0x01C9,   /* Info key.     */
    LEFT: 0x0025,   /* Left arrow key.     */
    UP: 0x0026,     /* Up arrow key.     */
    RIGHT: 0x0027,  /* Right arrow key.     */
    DOWN: 0x0028,   /* Down arrow key.     */
    ENTER: 0x000D,  /* Enter key.     */
    BACK: 0x01CD,   /* Backspace key.     */
    EXIT: 0x03E9,   /* Exit key.     */
    RED: 0x0193,    /* Red color key.     */
    GREEN: 0x0194,  /* Green color key.     */
    YELLOW: 0x0195, /* Yellow color key.     */
    BLUE: 0x0196,   /* Blue color key.     */
    STOP: 0x019D,   /* Stop key.     */
    PLAY: 0x019F,   /* Play key.     */
    PAUSE: 0x0013,  /* Pause key.     */
    REWIND: 0x019C, /* Rewind key.     */
    FAST_FORWARD: 0x01A1,   /* Fast forward key.     */
    PORTAL: 0x025A, /* Portal key.     */
    POWER: 0x0199,  /* Power key.     */
    VOL_UP: 0x01BF, /* Volume up key.     */
    VOL_DOWN: 0x01C0,   /* Volume down key.     */
    MUTE: 0x01C1,       /* Mute key.     */
    FORWARD: 0x00A7,    /* Forward key.     */
    ZOOM: 0x00FB,       /* Zoom key.     */
    SETTINGS: 0x0263,   /* Settings key.     */
    MENU: 0x0012,   /* Menu key or home key.     */
    T_OPT: 0x03EC,      /* Text option key.     */
    TEXT: 0x01CB,       /* Teletext key.     */
    TV: 0x02DA,         /* TV key.     */
    SMART_HOME: 0x02DE, /* Smart Home key.     */
};

function onKeyDown(event) {
    log('event.keyCode : ' + event.keyCode);
    switch (event.keyCode) {
        case idcap.key.Code.NUM_0:
            clearLogMsg();                                      //clear the log msg
            break;
        case idcap.key.Code.NUM_1:
            setInstantMode("2");                                //Set instant mode - Instant mute 
            break;
        case idcap.key.Code.NUM_2:
            setPowerMode("WARM");            //Hide HCAP App layer 
            break;
        case idcap.key.Code.GUIDE:
            setPowerMode("NORMAL");          //Show HCAP App layer on top
            break;
        case idcap.key.Code.NUM_3:
            setInstantMode("1");                                //Set instant mode - Instant Reboot
            break;
        case idcap.key.Code.NUM_4:
            setInstantMode("0");                                //Set instant mode - OFF
            break;
        case idcap.key.Code.NUM_5:
            setWOL("normal");                                //Set WOL - normal
            break;
        case idcap.key.Code.NUM_6:
            setWOL("warm");                                //Set WOL - warm
            break;
        case idcap.key.Code.NUM_7:
            setWOL("off");                                //Set WOL - off
            break;
        case idcap.key.Code.NUM_8:
            Show_current_status();                      //Show current setting info of WOL, Instant mode 
            break;
        case idcap.key.Code.NUM_9:
            log("Reboot!");
            reboot();
            break;
        case idcap.key.Code.PORTAL:
            window.location.href = "";                          //restart app
            break;
        default:
            break;
    }
}
