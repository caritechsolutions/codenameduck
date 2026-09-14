# IDCAP API index (idcap.js 1.1.1, extracted from LG IDCAP docs)

Call style: `idcap.request(uri, {parameters:{...}, onSuccess, onFailure})` — also returns a Promise.


## application

- `idcap://application/destroy` — Terminates an application by application ID. The example code below shows to close applications with the application ID on your device. Usin
- `idcap://application/foregroundapp/get` — Informs the current foreground application on your device. The example code below shows to get the application ID on the foreground applicat
- `idcap://application/install` — Install a downloadable type of app on your device. The example code below shows to install applications with the application ID on your devi
- `idcap://application/launch` — Launches an application corresponding to the given application ID. 'params' can be given in the parameters during the launch of the applicat
- `idcap://application/list` — Lists all of the available applications on your device. You can get all available application information using this API. The example code b
- `idcap://application/register` — Some applications need to register the token issued by the contract to activate before launching or installing. If the application token is
- `idcap://application/register/status` — Get the status of the activation of the application. If the application token is not registered properly, the application may not appear on
- `idcap://application/uninstall` — Uninstall a downloadable type of app from your device. The example code below shows to uninstall applications with the application ID on you

## audio

- `idcap://audio/bluetooth/connect` — Connects to a Bluetooth speaker. This API is used to establish a connection with a Bluetooth speaker, allowing audio to be played through th
- `idcap://audio/bluetooth/disconnect` — Disconnects from a Bluetooth speaker. This API is used to terminate the connection with a Bluetooth speaker, stopping audio playback through
- `idcap://audio/bluetooth/discover` — Discovers nearby Bluetooth speakers. This API scans for Bluetooth speakers within range and lists them for potential connection.
- `idcap://audio/bluetooth/reconnect` — Reconnects to a previously connected Bluetooth speaker. This API attempts to re-establish a connection with a Bluetooth speaker that was pre
- `idcap://audio/bluetooth/devicelist` — Retrieves the list of paired Bluetooth devices. This API provides a list of all Bluetooth devices that have been paired with the system. PAR
- `idcap://audio/bluetooth/remove` — Removes the paired history of a Bluetooth device. This API deletes the pairing information of a Bluetooth device, effectively unpairing it.
- `idcap://audio/defaultsoundout/get` — Gets the default sound output. Even though a user changes the sound out value, this value is set for the sound output after rebooting the TV
- `idcap://audio/defaultsoundout/set` — Sets the default speaker to output sound. Even though a user changes the sound out value, this value is set for the sound output after reboo
- `idcap://audio/digitalaudioinputmode/get` — Gets the digital audio input mode for each input source. Use this method to mix the audio from different input sources with video from HDMI
- `idcap://audio/digitalaudioinputmode/set` — Sets the digital audio input mode for each input source. Use this method to mix the audio from different sources with video from HDMI or DP
- `idcap://audio/mute/set` — Sets whether to mute or unmute the system sound.
- `idcap://audio/notification/play` — Plays the various system alert sounds based on the name passed to it. The API is used to play audio feedback in response to user interaction
- `idcap://audio/soundcard/get` — Gets the soundcard list for the system's sound output.
- `idcap://audio/soundinput/get` — Gets the current active sound input device.
- `idcap://audio/soundinput/set` — Sets the sound input device for recording.
- `idcap://audio/soundinput/list` — Gets the list of supported audio input devices and their connection status.
- `idcap://audio/soundmode/get` — Returns the current sound mode and audio balance. The sound mode is for getting the best sound quality for a given media type.
- `idcap://audio/soundmode/set` — Sets the sound mode to get the best sound quality for a given media type and adjusts the audio balance.
- `idcap://audio/soundout/get` — Returns the speaker type for sound out.
- `idcap://audio/soundout/set` — Sets the speaker type for sound output.
- `idcap://audio/soundout/list` — Gets the output device list and connection status.
- `idcap://audio/source/status/get` — Returns the system's audio source information, such as the volume level, ID, type of the system's audio source.
- `idcap://audio/source/volume/get` — Gets the volume level of the system audio source.
- `idcap://audio/source/volume/set` — Sets the volume level of the system audio source.
- `idcap://audio/source/mute/set` — Sets the volume level of the system audio source.
- `idcap://audio/volumelevel/get` — Returns the device's system sound information, such as the sound volume level and mute status.
- `idcap://audio/volumelevel/set` — Sets the system sound volume level.

## configuration

- `idcap://configuration/airplay/brokerserver/get` — Getting the configuration of the Airplay Discovery Broker Server. The properties airplay and airplay_broker_mode must be enabled before oper
- `idcap://configuration/airplay/brokerserver/set` — Setting the configuration of the Airplay Discovery Broker Server. The properties airplay and airplay_broker_mode must be enabled before oper
- `idcap://configuration/airplay/captiveportal/set` — Setting the access token value of the Airplay's captive portal. Note The supported Airplay function might vary by model.
- `idcap://configuration/airplay/qrcode/get` — Getting the string data for the QR code for the Airplay pairing. To enable the Airplay function, you need to enable the airplay property in
- `idcap://configuration/brightnesscontrol/get` — Gets brightness control values such as min, max backlight and brightness control. For special outdoor models, it supports Smart Brightness C
- `idcap://configuration/brightnesscontrol/set` — Sets brightness control values such as min, max backlight and brightness control. For special outdoor models, it supports Smart Brightness C
- `idcap://configuration/hotelmode/get` — Gets the current hotel mode settings.
- `idcap://configuration/hotelmode/set` — Sets the hotel mode. If this method is called while the installation menu is being shown, the menu is destroyed automatically. The reboot is
- `idcap://configuration/idcapmode/get` — Gets the current IDCAP mode. The IDCAP mode is related to the application visibility and the key control. The following table specifies app
- `idcap://configuration/idcapmode/set` — Sets the IDCAP mode. For more information about IDCAP mode, refer to idcap://configuration/idcapmode/get .
- `idcap://configuration/installermenuitem/get` — Gets the current value of the installer menu item.
- `idcap://configuration/installermenuitem/set` — Sets the installer menu item value.
- `idcap://configuration/ismmethod/get` — Gets the current ISM (Image Sticking Minimization) method.
- `idcap://configuration/ismmethod/set` — Sets the ISM (Image Sticking Minimization) method.
- `idcap://configuration/locale/get` — Returns the locale specifier for the current locale.
- `idcap://configuration/locale/set` — Requests a system locale change to a commercial TV or signage device. It is returned soon after the request is done. If the request is succe
- `idcap://configuration/locale/list` — Returns a list of available locale settings.
- `idcap://configuration/masterpin/activation/get` — Gets whether the master pin is activated.
- `idcap://configuration/masterpin/activation/set` — Sets the activation of master pin.
- `idcap://configuration/picturemode/get` — Gets the picture mode. Each picture mode contains a set of predefined picture properties.
- `idcap://configuration/picturemode/set` — Sets the picture mode. Each picture mode contains a set of predefined picture properties.
- `idcap://configuration/property/get` — Gets a platform property. The keys of property consists of independent properties and shows the characteristics of the platform system. The
- `idcap://configuration/property/set` — Sets a platform property. The keys of property consists of independent properties and shows the characteristics of the platform system. The
- `idcap://configuration/servicecountry/get` — Gets the location code of the LG service country. "ZZ" is Unknown or Invalid Territory code
- `idcap://configuration/servicecountry/set` — Sets the location code of the LG service country. When you execute this API, the TV will be rebooted immediately. "ZZ" is Unknown or Invalid

## externalinput

- `idcap://externalinput/get` — Gets the source type and index of the current audio/video. Types and indexes of input sources depend on the hardware spec. The index indicat
- `idcap://externalinput/set` — Sets the source type and index for the current audio/video. Types and indexes of input sources depend on the hardware spec. For the external
- `idcap://externalinput/inputlist/get` — Gets the external input information. The external input information includes information about the input port, signal detection, count, and

## iot

- `idcap://iot/bindingid/get` — Gets the binding ID list.
- `idcap://iot/bridge/get` — Gets the bridge status.
- `idcap://iot/bridge/set` — Requests to set the bridge status. If the bridge status is changed, {Event} idcap::iot_bridge_status_changed is delivered. In "scan" mode, a
- `idcap://iot/component/set` — Requests to set the component value. If the action of this method is succedeed or failed, {Event} idcap::iot_set_component_result_received w
- `idcap://iot/factoryreset` — Requests to do a factory reset for core DB and binding DBs. If it is successful, {Event} idcap::iot_factory_reset_result_received ] is deliv
- `idcap://iot/frameworkstatus/get` — Gets the current IoT framework status.
- `idcap://iot/thing/nickname/set` — Sets the nickname of a thing. If the nickname of a thing is changed, {Event} idcap::iot_thing_meta_data_changed is delivered.
- `idcap://iot/thing/register` — Requests to register for the discovered thing. If the discovered thing is registered, {Event} idcap::iot_thing_registered and {Event} idcap:
- `idcap://iot/thing/reject` — Requests to reject a registration for the discovered thing. If the discovered thing is rejected to register, {Event} idcap::iot_thing_reject
- `idcap://iot/thing/synchronize` — Requests to synchronize component values of an IoT thing between component values in the cache and the thing. This request is a trigger to u
- `idcap://iot/thing/unregister` — Requests to unregister a thing. If it is unregistered successfully, {Event} idcap::iot_thing_unregistered is delivered.
- `idcap://iot/thinglist/get` — Gets the cached information for registered things. Each parameter works as a filter for the result things list. If several parameters are gi
- `idcap://iot/versions/get` — Gets versions of the IoT service, the core, and bindings.

## network

- `idcap://network/beacon/get` — Gets the configuration of beacons, which are iBeacon and Eddystone. A beacon is a small device that transmits a Bluetooth signal that can be
- `idcap://network/beacon/set` — Sets the configuration of beacons, which are iBeacon and Eddystone.
- `idcap://network/beacon/scan` — Active the scanning for nearby beacon device.
- `idcap://network/checkupinfo/get` — Gets the network checkup information.
- `idcap://network/checkupinfo/set` — Sets the network checkup information.
- `idcap://network/configuration/get` — Gets the network information.
- `idcap://network/configuration/set` — Sets the network information.
- `idcap://network/eap/certificate/set` — Set certificate files to apply CA certificate, client certificate, and client private key for 802.1X EAP authentication. The certificate fil
- `idcap://network/eap/certificate/get` — Get the certificate file name applied for 802.1X EAP authentication such as for CA certificate, client certificate, and client private key.
- `idcap://network/ping` — Sends a ping command to the specified IP.
- `idcap://network/portblocklist/get` — Gets the blocked port list.
- `idcap://network/portblocklist/set` — Sets the port block.
- `idcap://network/proxy/get` — Gets the configuration of a proxy server. A proxy is a server that acts as an intermediary between a client device and the internet. A proxy
- `idcap://network/proxy/set` — Sets the configuration of a proxy server.
- `idcap://network/proxybypasslist/get` — Gets the proxy bypass list.
- `idcap://network/proxybypasslist/set` — Sets the proxy bypass list.
- `idcap://network/softap/get` — Gets the configuration of a Soft AP (Access Point). SoftAP stands for "software-enabled access point". SoftAP allows the TV to function as a
- `idcap://network/softap/set` — Sets the configuration of a Soft AP (Access Point).
- `idcap://network/softap/advanced/get` — Gets the advanced configuration of a Soft AP (Access Point). This API is available when the Soft AP is enabled and works only for commercial
- `idcap://network/softap/advanced/set` — Sets the advanced configuration of a Soft AP (Access Point). This API is available when when the Soft AP is enabled and works only for comme
- `idcap://network/softap/clientinfo/get` — Gets the Soft AP client information. Returns Client's MAC address.
- `idcap://network/tcpdaemon/close` — Closes the TCP socket daemon. UDP (User Datagram Protocol) and TCP (Transmission Control Protocol) are two common communication protocols us
- `idcap://network/tcpdaemon/open` — Opens the TCP socket daemon. If you try to open a TCP socket daemon with a port that has already been opened, it fails. In this case, close
- `idcap://network/udpdaemon/close` — Closes the UDP socket daemon. UDP (User Datagram Protocol) and TCP (Transmission Control Protocol) are two common communication protocols us
- `idcap://network/udpdaemon/open` — Opens the UDP socket daemon. If you try to open a UDP socket daemon with a port that has already been opened, it fails. In this case, close
- `idcap://network/udpdata/send` — Send the UDP packet data to the remote UDP server.
- `idcap://network/wifi/aplist/get` — Gets the list of the detected AP (Wi-Fi Network) information. WiFi is a wireless networking technology that allows devices to connect to the
- `idcap://network/wifi/connect` — Connects the Wi-Fi network using the SSID and password.
- `idcap://network/wifi/diagnostic/get` — Gets the Wi-Fi diagnostic information.
- `idcap://network/wifi/wps/start` — Starts the WPS (Wi-Fi Protected Setup) using PBC (Push Button Configuration) or PIN.
- `idcap://network/wifi/wps/stop` — Stops WPS (Wi-Fi Protected Setup) operation.

## power

- `idcap://power/activestandby/register` — Receives events of idcap:power_enter_activestandby . This occurs when the power state is in the WARM(UPDATE) state.
- `idcap://power/activestandby/request` — Determines whether to do additional actions in the WARM(UPDATE) state. When power state is in activestandby WARM(UPDATE) mode and the App ha
- `idcap://power/command` — Executes the power-related command.
- `idcap://power/dpm/get` — Gets the DPM (Display Power Management) mode and the DPM wake-up. Each DPM mode and DPM signal type returns the current status of DPM.
- `idcap://power/dpm/set` — Sets the DPM mode and the DPM wake-up. Each DPM mode and DPM signal type returns the current status of DPM.
- `idcap://power/iswarmupdate` — Gets whether the commercial TV power is in the warm update or not. The "warm update" means the duration from the start of the IDCAP app upgr
- `idcap://power/onoffhistory/get` — Gets the startup and shutdown history.
- `idcap://power/pmmode/get` — Gets the PM (Power Management) mode information. The PM mode has a set of the predefined properties. The PM mode determines how a signage de
- `idcap://power/pmmode/set` — Sets the PM (Power Management) mode. Each PM mode has a set of the predefined PM mode properties. The power management modes determine how a
- `idcap://power/powermode/get` — Gets the current power mode state of device. "mode" can be "NORMAL" or "WARM".
- `idcap://power/powermode/set` — Sets the current power mode state of device. "mode" can be "NORMAL" or "WARM". PM Mode (screenOff, screenOffAlways, screenOffBacklight) sett

## procentric

- `idcap://procentric/application/launch` — Loads the IDCAP HTML app. When the IDCAP HTML app has already been loaded, the IDCAP HTML app is reloaded according to the alternative_url p
- `idcap://procentric/application/manual/download` — Upgrades an app on the TV to the new version of the app from the remote server. The new version’s app is launched on the next boot of the TV
- `idcap://procentric/application/manual/disable` — Deletes the downloaded app using idcap://application/manual/download. After using this API, when turning off TV, the app is downloaded accor
- `idcap://procentric/application/destroysignal/begin` — Informs a commercial TV that the app starts cleaning up its resource.
- `idcap://procentric/application/destroysignal/end` — Informs a commercial TV that the app finishes the cleanup job.
- `idcap://procentric/rms/request` — Requests the RMS (Remote Management System) command in the XML format to RMS. The RMS XML protocol is provided separately. The response for
- `idcap://procentric/server/get` — Gets the current configuration of the Pro:Centric server.
- `idcap://procentric/server/set` — Sets the configuration of the Pro:Centric server.
- `idcap://procentric/servicexml/get` — Gets the LG Service XML content.

## security

- `idcap://security/certificatelist/get` — Gets the registered server certificate list.
- `idcap://security/certificatelist/register` — Registers the server certificate list to validate the key from the web server as part of a PKI (Public Key Infrastructure). A reboot is requ
- `idcap://security/certificatelist/reset` — Resets all server certificate lists. After reset, a reboot must be needed.
- `idcap://security/certificatelist/unregister` — Unregisters the server certificate list. A reboot is required after the unregistration.
- `idcap://security/clientcertificate/exist` — Returns whether a client certificate was registered or not.
- `idcap://security/clientcertificate/register` — Registers a client certificate and its private key for TLS and SSL client authentication. After registration, a reboot is needed. If a clien
- `idcap://security/clientcertificate/unregister` — Unregisters a client certificate and its private key, and deactivates the TLS authentication.
- `idcap://security/conditioncertificate/register` — Register the condition certificate. This is regarding activating the certificate for the WebEngine upgrade. Please note that using this will
- `idcap://security/conditioncertificate/register/status` — Get the status of the registration of the WebEngine upgrade. Regarding activating the AirServer service, please refer to the 'idcap://applic
- `idcap://security/decrypt` — Decrypts an input file. This method makes a decrypted file.
- `idcap://security/md5hash/get` — Gets the MD5 hashing value of the input file.
- `idcap://security/securestore/save` — Enhances secure data retention and ensures the continuous safeguarding of confidential assets. The secure store has a maximum capacity of 10
- `idcap://security/securestore/get` — Executes the data retrieval operation for stored data.
- `idcap://security/securestore/list` — Generates a list of all secured data.
- `idcap://security/securestore/remove` — Ensures complete removal of sensitive data.

## signage

- `idcap://signage/admin/password/set` — Sets the admin password of admin page on UI settings. It checks current password and new password by the following orders. 1) Current passwo
- `idcap://signage/application/launch` — Launches the signage app. You should install the target app, such as ZIP type or IPK type.

## sigange

- `idcap://sigange/application/upgrade` — Upgrades an app on the local storage or USB flash drive to the new version of the app from a remote server or USB flash drive. The new versi

## signage

- `idcap://signage/application/remove` — Removes an app on the local storage or USB flash drive. A running app cannot be removed by itself through this method.
- `idcap://signage/application/info/get` — Gets the information of the IPK type app from appinfo.json. If current app type is not an IPK type, a failure callback is called. This metho
- `idcap://signage/enterprisecode/set` — Sets the enterprise code. After setting the enterprise code, the device reboots automatically. To disable the enterprise code, perform a dev
- `idcap://signage/failovermode/get` — Returns the failover mode and the priority of inputs. According to the failover setting value, the signage device switches to the next prior
- `idcap://signage/failovermode/set` — Sets the failover mode and the priority of inputs. According to the failover setting value, signage device will automatically switch to the
- `idcap://signage/server/get` — Returns the SI server setting property. The SI server property information includes the server IP address, port, app launch mode, app type,
- `idcap://signage/server/set` — Configures the SI server setting property. The SI server property information includes the server IP address, port, app launch mode, app typ
- `idcap://signage/tileinfo/get` — Returns the information related to tile mode setting values. The tile mode can be used for multi-monitor displays.
- `idcap://signage/tileinfo/set` — Sets the tile mode. The tile mode can be used for multi-monitor displays.
- `idcap://signage/whitebalance/get` — Gets the RGB value of the white balance.
- `idcap://signage/whitebalance/set` — Sets the RGB value of the white balance.

## storage

- `idcap://storage/file/copy` — Copies a file or directory. If a file with the same name already exists, it will be replaced. If ‘to’ and ‘from’ refer to the same file, it
- `idcap://storage/file/download` — Downloads the file given by URI to the path in the USB storage or local storage.** If a file with the same name already exists, it is replac
- `idcap://storage/file/downloadstatus` — Gets the file download status.
- `idcap://storage/file/exist` — Checks if the given file exists or not. The path should be in the URI format. If the URI is for external memory, the external storage device
- `idcap://storage/file/list` — Lists files in a directory stored in the external or internal memory. The directory location is in the URI format. Listing the directory bey
- `idcap://storage/file/mkdir` — Creates a directory. The path should be described in the URI format. The directory is created recursively. If you need to see how to specify
- `idcap://storage/file/move` — Moves a file or directory. If a file with the same name already exists, it is replaced. If ‘to’ and ‘from’ refer to the same file, it return
- `idcap://storage/file/read` — Reads a file. If you need to see how to specify a URI scheme for the API method and how to access the file path, refer to Handling file path
- `idcap://storage/file/remove` — Removes file in the internal or external storage. The target path is described in the URI form. Refer to the detailed usage. If you need to
- `idcap://storage/file/stat` — Gets the file stat. The stat for the linked file is not shown.
- `idcap://storage/file/unzip` — Unzips a file. It should be compressed in the PKI-ZIP format.
- `idcap://storage/file/zip` — Compresses files or folders. This API is used to create a ZIP archive from specified files or folders, useful for reducing file size or bund
- `idcap://storage/file/upload` — Uploads the file given by URI to the FTP server. If the file with the same name already exists, it is replaced. file://internal/ and file://
- `idcap://storage/file/write` — Writes a file. If you need to see how to specify a URI scheme for the API method and how to access the file path, refer to Handling file pat
- `idcap://storage/info/get` — Gets the internal memory status. It returns free space and total space in kilobytes. For external devices, refer to idcap://storage/usbinfo/
- `idcap://storage/usb/format` — Formats a USB drive. The supported file system is FAT32. The result can be obtained by registering the {Event} idcap::usb_formatted
- `idcap://storage/usbinfo/get` — Gets the USB flash drive information. It returns the usbList array of the object including the USB flash drive name, vendor, and product in

## system

- `idcap://system/audioptsoffset/get` — Gets the audio PTS offset.
- `idcap://system/audioptsoffset/set` — Sets the audio PTS offset.
- `idcap://system/avsync/get` — Gets the AV sync related features.
- `idcap://system/avsync/set` — Sets the AV sync related features.
- `idcap://system/browsingdata/clear` — Clears the browsing data on the signage monitor.
- `idcap://system/camera/control/get` — Gets the current value of the camera control type.
- `idcap://system/camera/control/set` — Sets the value of the camera control type.
- `idcap://system/camera/information/get` — Gets information about currently available camera devices
- `idcap://system/carouseldatacache/clear` — Clears the cache storage for the carousel data. All carousel caches are deleted.
- `idcap://system/carouseldatacache/iscached` — Checks if the carousel data is cached or not.
- `idcap://system/carouseldatacache/request` — Requests that the carousel data file to be cached for the given URL. The carousel data are cached internally. When the carousel data is cach
- `idcap://system/cloningdata/import` — Imports cloning data from a file into the device. This acts exactly the same as USB cloning. When the importing job is done, the IDCAP app g
- `idcap://system/cloningdata/export` — Exports cloning data into a file. This acts exactly the same as USB cloning. When the exporting job is done, the IDCAP app gets the notifica
- `idcap://system/display/mute` — Turns on/off the display panel. This only affects the panel, not the main power.
- `idcap://system/display/mute/get` — Gets current mute status of display
- `idcap://system/firmware/progress/get` — Gets the firmware upgrade status.
- `idcap://system/firmware/upgrade` — Upgrades firmware or Micom using downloaded file in local storage or USB. The “path” parameter is required. If the upgrade is successful, th
- `idcap://system/forcesfirmware/progress/get` — Gets the upgrade status of forced firmware. It is available only on the models that provide the NSU (Network Software Update) function.
- `idcap://system/forcesfirmware/upgrade/start` — Performs the upgrade of the forced firmware. It is available only on the models that provide the NSU (Network Software Update) function.
- `idcap://system/forcesfirmware/upgrade/cancel` — Cancels the upgrade of the forced firmware. It is available only on the models that provide the NSU (Network Software Update) function.
- `idcap://system/remotefirmware/progress/get` — Gets the status of the remote firmware upgrade.
- `idcap://system/remotefirmware/upgrade/start` — Upgrade the firmware using the EPK file in the remote site. The “path” parameter is required. If the upgrade is successful, the monitor rest
- `idcap://system/remotefirmware/upgrade/cancel` — Cancels the remote firmware upgrade.
- `idcap://system/focus/get` — Gets whether the IDCAP app gets focused or not. This works only when the property block_hotkey is “1”.
- `idcap://system/focus/set` — Requests an IDCAP app to get focused. If this request is successful and the focus is changed from the preloaded app to the IDCAP app, the ID
- `idcap://system/hdmiout/status/get` — Gets the current HDMI out status. The API for the status of the TV (or monitor) connected for STB output.(Support STB Only)
- `idcap://system/key/add` — Adds/Modifies a key item in the key table. Add: If a key code is not in the key table, the key item is added to the key table. Modify: If a
- `idcap://system/key/remove` — Removes a key item in the key table. Refer to NOTE for detailed information.
- `idcap://system/key/reset` — Clears the key table and restores it to the factory default.
- `idcap://system/key/send` — Delivers a virtual key code from an app to the TV or signage device. The virtual key code is defined by LG and is processed like a key from
- `idcap://system/mouse/click` — Clicks the pointer of the pointing devices (MMR) in the current position.
- `idcap://system/mouse/pointeron/get` — Checks whether the pointer of the pointing devices (MMR) is on or off. The APIs related to the mouse visibility (idcap://system/virtualmouse
- `idcap://system/mouse/pointeron/set` — Switches the pointer of the pointing devices (MMR) on or off.
- `idcap://system/mouse/pointersize/set` — Sets the pointer size of pointing devices. (MMR)
- `idcap://system/mouse/position/get` — Gets the pointer position of pointing devices. (MMR) The position is the coordinate in the OSD resolution. (Property display_resolution ) PA
- `idcap://system/mouse/position/set` — Sets the pointer position of pointing devices. (MMR) The position is the coordinate in the OSD resolution. (Property display_resolution ) --
- `idcap://system/virtualcursor/visible/get` — Gets the browser virtual mouse visibility. If the browser visibility is true, you can control the mouse with the arrow keys and the OK key.
- `idcap://system/virtualcursor/visible/set` — Sets the browser virtual mouse visibility. If the browser visibility is true, you can control the mouse with the arrow keys and the OK key.
- `idcap://system/mpidata/exchange` — Sends the vendor-specific data using the MPI card and receives the reply data. The MPI (Multi-Protocol Interface) protocol is a proprietary
- `idcap://system/mpidata/send` — Sends the vendor-specific data to the MPI card. The MPI data is received by {Event} mpi_data_received.
- `idcap://system/mpi/info/get` — Gets the MPI cable status from the MPI card. The MPI cable status is received by {Event} mpi_cable_status_changed.
- `idcap://system/mpi/slave/command/send` — Sends the vendor-specific data to the MPI slave card. The MPI data is received by {Event} mpi_data_received.
- `idcap://system/mpi/slave/power/set` — Control the power status of the MPI slave card.
- `idcap://system/nosignalimage/get` — Returns the current state of the NO signal image. Refer to NOTE for detailed information of “downloaded” state.
- `idcap://system/nosignalimage/set` — Turns the NO signal image on or off. Refer to NOTE for detailed information of the “downloaded” state.
- `idcap://system/peripheral/information/get` — Gets the peripheral information of the system. When the peripheral status is changed, the IDCAP app gets the notification {Event} idcap::per
- `idcap://system/reset` — Does the factory reset or soft reset.
- `idcap://system/rs232c/configuration/get` — Returns the current RS-232C configuration. This is worked only when the property rs232c for Commercial TV, or rs232c_mode for Signage is “1”
- `idcap://system/rs232c/configuration/set` — Sets the RS-232-C configuration. This is worked only when the property rs232c for the commercial TV, or rs232c_mode for the signage is “1”.
- `idcap://system/rs232c/data/send` — Sends RS-232-C data. This is worked only when the property rs232c for the commercial TV, or rs232c_mode for the Signage is “1”.
- `idcap://system/rs232c/startupdata/clear` — Clears the startup command fired to RS-232-C when the TV is turned on. This is worked only when the property rs232c for the commercial TV, o
- `idcap://system/rs232c/startupdata/set` — Sets the startup command fired to RS-232-C when the TV is turned on. This is worked only when the property rs232c for the commercial TV, or
- `idcap://system/screenkeyboardlanguagelist/get` — Gets the list of the supported screen keyboard languages. The screen keyboard language list consists of language codes and delimiter comma (
- `idcap://system/screenkeyboardlanguage/set` — Sets the screen keyboard language.
- `idcap://system/screenkeyboardlanguagelist/set` — Sets the keyboard language. A reboot is needed to apply the setting value.
- `idcap://system/sensorvalues/get` — Returns various sensor values. The supported sensors are differed by models.
- `idcap://system/speech/host/decide` — Decides which module is responsible for handling speech recognition.
- `idcap://system/speech/tts/speak` — Reads out an input text in the language chosen by the user.
- `idcap://system/speech/tts/stop` — Stops the text-to-speech processing immediately and ignores the pending text on the buffer. Note: There could be some noise in the output wh
- `idcap://system/speech/tts/availablelist/get` — Gets the list of languages that are supported by the TTS provider.
- `idcap://system/usage/get` — Returns the device’s usage information, including CPU and memory information.
- `idcap://system/usagetime/get` — Returns the device’s uptime and the total used hours.
- `idcap://system/videoptsoffset/get` — Gets the video PTS offset.
- `idcap://system/videoptsoffset/set` — Sets the video PTS offset.

## time

- `idcap://time/alarminformation/get` — Gets the alarm time, alarm channel, and alarm volume level of the TV. These settings are applied only once at the alarm time and are disable
- `idcap://time/alarminformation/set` — Sets the alarm time, alarm channel, and alarm volume level of the TV. These settings are applied only once at the alarm time and are disable
- `idcap://time/currenttime/get` — Gets the current time.
- `idcap://time/currenttime/set` — Sets the current time.
- `idcap://time/holidayschedule/get` — Gets the holiday schedule.
- `idcap://time/holidayschedule/reset` — Resets the holiday schedule.
- `idcap://time/holidayschedule/set` — Sets the holiday schedule.
- `idcap://time/localtime/get` — Gets the TV time. The TV time is the local time after applying GMT offset for time zone and daylight saving time. In the error case, the fai
- `idcap://time/localtime/set` — Sets the TV time. The input time is the local time after applying the GMT offset for the time zone and daylight saving time(DST). The GMT of
- `idcap://time/onofftimer/add` — Adds the on/off timer. (The maximum number of timers for each on/off is 21.)
- `idcap://time/onofftimer/cancel` — Cancels the on/off timer.
- `idcap://time/onofftimer/list` — Gets the on/off timer list.
- `idcap://time/onofftimer/reset` — Resets all on/off timers.
- `idcap://time/powerofftimer/get` — Gets the sleep time to power off.
- `idcap://time/powerofftimer/set` — Sets the power-off timer of the TV.
- `idcap://time/powerontime/get` — Gets the wake-up time of the TV. This setting is applied only once at the wake-up time and is disabled. If the setting is disabled, this met
- `idcap://time/powerontime/set` — Sets the wake-up time of the TV. This setting is applied only once at the wake-up time and is disabled. This method sets parm.hour to -1 and
- `idcap://time/timezone/get` — Gets the current time zone setting.
- `idcap://time/timezone/set` — Sets the time zone that should be one of the lists from idcap://time/timezone/list .
- `idcap://time/timezone/list` — Gets the list of the time zone supported on signage monitor.

## tv

- `idcap://tv/channel/audiolanguageindex/get` — Gets the audio language index of the current channel. If an app wants to map the index to audio language code, this method can get the audio
- `idcap://tv/channel/audiolanguageindex/set` — Sets the audio language of the current channel. Item Value audio language list en,ko,fr,en,xx index 0, 1, 2, 3, 4 If the app wants to set th
- `idcap://tv/channel/audiolanguagelist/get` — Gets the list of supported audio languages in the current channel. The audio language list is composed of language codes and delimiter comma
- `idcap://tv/channel/change/request` — Requests to change the current channel. The result for the channel change operation can be obtained by registering the {Event} idcap::channe
- `idcap://tv/channel/datachannel/get` — Gets the information about the Pro:Centric data channel (RF Channel or IP Channel), which is the channel used to download an app. In case of
- `idcap://tv/channel/get` — Gets the current channel information. For detailed information, such as examples and related information, refer to idcap://tv/channel/change
- `idcap://tv/channel/inbanddataservice/get` — Gets the available inband data service in the current channel.
- `idcap://tv/channel/inbanddataservice/launch` — Launches the app of the inband data service type in the current channel.
- `idcap://tv/channel/programinfo/get` — Gets the information about the current program and the next program in the current channel.
- `idcap://tv/channel/replay` — Replays the AV play of the current channel. RF channel: Stops the RF tuning and stops playing AV. IP channel: Leaves the IP multicast group
- `idcap://tv/channel/signalstatus/get` — Gets the channel signal status.
- `idcap://tv/channel/startchannel/get` — Gets the start channel information that is the channel displayed at first when TV is turned on. This API is very similar to idcap://tv/chann
- `idcap://tv/channel/startchannel/set` — Sets the start channel that is displayed at first when TV is turned on. This method is very similar to idcap://tv/channel/change/request , b
- `idcap://tv/channel/stop` — Stops the AV play of the current channel. RF channel: Stops the RF tuning and stops playing AV. IP channel: Leaves the IP multicast group an
- `idcap://tv/channel/subtitleindex/get` — Gets the subtitle index of the current channel. If an app wants to map the index to subtitle setting value, get subtitle list of the current
- `idcap://tv/channel/subtitleindex/set` — Sets the subtitle index of the current channel. Item Value Subtitle List off, en, ko, fr, en, xx, eng index 0, 1, 2, 3, 4, 5, 6 If the app w
- `idcap://tv/channel/subtitlelist/get` — Gets supported subtitle list of the current channel. The subtitle list consists of subtitle setting values and delimiter comma(','). The app
- `idcap://tv/channel/lgchannellist/get` — Gets supported the channel list of the LG channel. This is worked only when the property lgchannels is '1'. Supported LG Channels may vary b
- `idcap://tv/checkout/request` — Restores the checkout snapshot items and clears the system-dependent cache and history. The rebooting system is strongly recommended after c
- `idcap://tv/checkout/snapshot` — Stores checkout snapshot items. The checkout snapshot items are system (or the TV model)-dependent.
- `idcap://tv/media/audiolanguage/get` — Gets the list of the supported audio languages and the index of list in the current media. The audio language list consists of language code
- `idcap://tv/media/audiolanguage/set` — Sets the audio language of the current media. Item Value audio language list en, ko, fr, en, xx Index 0, 1, 2, 3, 4
- `idcap://tv/media/control` — Controls a media file or stream. If the media file starts to play, then the ‘play_start’ event is invoked.
- `idcap://tv/media/create` — Controls a media file or stream. If the media file starts to play, the ‘play_start’ event is invoked.
- `idcap://tv/media/destroy` — Destroys the media playback. If you want to request a channel change during the playback, you should destroy the media object. Before destro
- `idcap://tv/media/information/get` — Gets the information of media. For example, the title of the currently loaded media.
- `idcap://tv/media/playposition/get` — Gets the position (in milliseconds) that the player is currently located in the media. If the length of the media is infinite/indeterminable
- `idcap://tv/media/playposition/set` — Sets the position of the player to continue playing the media. The ‘seek_done’ event will notify the result of this method. If you want to u
- `idcap://tv/media/playspeed/get` — [RTSP Only] Gets the speed (rate) of the current media. The speed (rate) where the media is currently playing. If the media has not yet star
- `idcap://tv/media/playspeed/set` — [RTSP Only] Sets the speed (rate) of the current media. If the media doesn’t start, calling this method (with any rate other than 0) starts
- `idcap://tv/media/shutdown` — Shuts down the media channel. You should call idcap://tv/media/shutdown after idcap://tv/media/destroy if there is no more need to use a med
- `idcap://tv/media/startup` — Starts up the media channel that is one of the input sources on the TV. And, you should call idcap://tv/media/shutdown after invoking idcap:
- `idcap://tv/media/state/get` — Gets the player status. Status can be ‘play’, ‘pause’, or ‘stop’.
- `idcap://tv/media/subtitle/get` — Gets the subtitle type, track number, and ISO639-1 language code if available.
- `idcap://tv/media/subtitle/set` — Sets the subtitle type and track number.
- `idcap://tv/media/subtitleon/get` — Gets the subtitle status of the current media.
- `idcap://tv/media/subtitleon/set` — Sets the subtitle of the current media on or off. If the subtitle URL is not ready, there is no effect on the screen. It works after setting
- `idcap://tv/media/subtitleurl/set` — Sets the subtitle URL of the current media. It replaces the subtitle URL registered by idcap://tv/media/control.

## utility

- `idcap://utility/alexa/init` — Initialize for Amazon Alexa service on the device.
- `idcap://utility/alexa/refresh` — Refresh the status of the authentication of the device.
- `idcap://utility/alexa/connect` — Connect and Login with Amazon Alexa Service. It will authenticate the user to using Alexa service. The room_number property is registered on
- `idcap://utility/alexa/disconnect` — Disconnect with Amazon Alexa Service.
- `idcap://utility/alexa/info/get` — Get the information of Amazon Alexa status for the device.
- `idcap://utility/alexa/micarray/get` — Get the status of activation of Mic Array for Amazon Alexa.
- `idcap://utility/alexa/micarray/set` — Set the activation of Mic Array for Amazon Alexa.
- `idcap://utility/btsoundsync/control` — Controls the BTSoundSync application. Precondition Bluetooth audio device is connected.
- `idcap://utility/btsoundsync/disconnect` — Disconnects the device paired with the given Bluetooth service profile.
- `idcap://utility/btsoundsync/scanstate/set` — Sets scan configurations such as visibility and connectability of the local device as a Bluetooth device. We highly recommend not changing t
- `idcap://utility/mobileremote/info/get` — Provides information for using the mobile remote. Mobile remote : Use your mobile device as the TV's virtual remote (SoftAP environment reco
- `idcap://utility/mobileremote/get` — Provides the status of the mobile remote.
- `idcap://utility/mobileremote/set` — Controls the status of the mobile remote.
- `idcap://utility/p2pshare/run` — Runs p2p file share. the result of API is an Event called idcap::p2p_result_received
- `idcap://utility/p2pshare/cancel` — Cancels the specific id of p2p file share.
- `idcap://utility/screen/capture` — Takes a screenshot and returns the URI of the screenshot image. If you need to see how to specify a URI scheme for the API method and how to
- `idcap://utility/toastmsg/create` — Creates a toast message. The text message is shown on display for a short time.
- `idcap://utility/usbpowercontrol/get` — Gets the status of the USB power control.
- `idcap://utility/usbpowercontrol/set` — Sets the status of the USB power control.

## video

- `idcap://video/master/set` — Sets the master device. The master device manages itself and all synchronization of slave devices.
- `idcap://video/mute/get` — Gets whether the video mute is on or off.
- `idcap://video/mute/set` — Turns on or off the video mute. When the channel is changed, the video mute setting is reset to off.
- `idcap://video/size/get` — Gets the current video size. Position and size parameters are based on the resolution of the property display_resolution .
- `idcap://video/size/set` — Resizes the video size. Position and size parameters are based on the resolution of the property display_resolution . The supported size val
- `idcap://video/slave/set` — Sets the slave device and connects to master device. The master device manages itself and all synchronization of slave devices.
