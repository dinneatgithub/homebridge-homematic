'use strict';


var HomeMaticRPCTestDriver = function (log, ccuip,port,system,platform) {
  this.log = log;
  this.system = system;
  this.ccuip = ccuip;
  this.platform = platform;
  this.data = 0
  this.interface = 'BidCos-RF.'
}

HomeMaticRPCTestDriver.prototype.init = function() {
  this.log.warn('RPC Driver - Dummy Class for Tests only')
}

HomeMaticRPCTestDriver.prototype.getIPAddress = function() {
  return "0.0.0.0";
}

HomeMaticRPCTestDriver.prototype.getValue = function(channel, datapoint, callback) {
  callback(this.data)
}

HomeMaticRPCTestDriver.prototype.setValue = function(channel, datapoint, value) {

}

HomeMaticRPCTestDriver.prototype.connect = function() {

}


HomeMaticRPCTestDriver.prototype.ccuWatchDog = function() {

}

HomeMaticRPCTestDriver.prototype.stop = function() {

}

HomeMaticRPCTestDriver.prototype.event = function(params,callback) {
  let that = this
  this.log.info('rpc <- event on %s'  , this.interface );
  this.lastMessage = Math.floor((new Date()).getTime() / 1000);
  var channel = this.interface + params[1];
  var datapoint = params[2];
  var value = params[3];
  let address = this.interface + params[1] + '.' + params[2]

  this.log.info("Ok here is the Event" + JSON.stringify(params));
  this.log.info("RPC single event for %s.%s with value %s",channel,datapoint,value);

  this.platform.foundAccessories.map(function(accessory) {
    if ((accessory.adress == channel) || ((accessory.cadress != undefined) && (accessory.cadress == channel))) {
      that.log.info("found accessory %s",accessory.adress );
      accessory.event(channel, datapoint, value);
    }
  });

  this.platform.eventAdresses.map(function(tuple){
    this.log.debug('check %s vs %s',address,tuple.address)
    if (address == tuple.address) {
      this.log.debug('found jump into')
      tuple.accessory.event(channel,datapoint, value)
    }
  })

  if (callback != undefined) {
    callback(null,[]);
  }
}

HomeMaticRPCTestDriver.prototype.multicall = function(events,callback) {
  this.log.debug('rpc <- system.multicall on %s'  , this.interface);
  let that = this
  params.map(function(events) {
    try {
      events.map(function(event) {
        if ((event["methodName"] == "event") && (event["params"] !== undefined)) {

          var params = event["params"];
          var channel = that.interface + params[1];
          var datapoint = params[2];
          var value = params[3];
          let address = that.interface + params[1] + '.' + params[2]

          that.log.debug("RPC event for %s %s with value %s",channel,datapoint,value);

          that.platform.foundAccessories.map(function(accessory) {
            var deviceAdress = channel.slice(0,channel.indexOf(":"));

            if ((accessory.adress == channel) || 
            ((accessory.cadress != undefined) && (accessory.cadress == channel)) || 
            ((accessory.deviceAdress != undefined) && (accessory.deviceAdress == deviceAdress))) {
              that.log.debug("Accessory %s found -> Send Event",accessory.name);
              accessory.event(channel,datapoint, value);
            }

          });

          that.platform.eventAdresses.map(function(tuple){
            if (address == tuple.address) {
              tuple.accessory.event(channel,datapoint, value)
            }
          })
        }
      });
    } catch (err) {}
  });

  if (callback != undefined) {
    callback(null,[]);
  }

}

HomeMaticRPCTestDriver.prototype.isPortTaken = function(port, fn) {
  return false;
}

module.exports = {
  HomeMaticRPCTestDriver : HomeMaticRPCTestDriver
}