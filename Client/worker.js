const io = require("socket.io-client")
var spawnedScripts = require("./functions/spawnScripts.js");
var config = require("./config.js");


var waitingTime = 0;

socket = io(config.master_addr,{
  "reconnection" : true,
  "reconnectionDelay" : 1000,
  "timeout" : 5000
});

console.log("client starting")
console.log("client trying to connect to master server...");


socket.on("connect", data => {
  console.log("Client " + socket.id+" succesfully connected");
  socket.emit("initialization", config.client_name);

});

socket.on("close", data => {
  if (data == "toomanyclients") {
    console.log("Too many clients connected. Check num_slaves argument on master server");
  }
  if (data == "finished") {
    console.log("Crawl successfully finished");
  }
  if (data == "cancel") {
    console.log("Crawl was cancelled");
  }
  console.log("Shutting down...");
  process.exit();
});

socket.on("disconnect", () =>{
  console.log("Lost connection to master server.");
});


socket.io.on("reconnect", (attempt)=>{
  console.log("Automatic reconnection successfull on " +attempt +". attempt.");
});

socket.io.on("reconnect_attempt", (attempt)=>{
  console.log("Trying to reconnect.");
});


socket.on("ping", function(){
  console.log("Testing latency to master server...");
  socket.emit("pingresults", config.client_name);
})


socket.on("url", data => {

  if (config.disable_proxy==false){
    spawnedScripts.spawnProxy(config.proxy_host, config.proxy_port, config.har_destination, config.proxy_script_location, data);
  } 
  if (data.toString() === "calibration") {
    spawnedScripts.spawnCrawler(config.crawl_script, config.master_addr, config.client_name, config.script_path, config.headless, config.disable_proxy, config.proxy_host, config.proxy_port, config.client_name, 0); //hier war socket.id
    console.log("starting calibration");

  }else if (data.toString() === "test") {

    spawnedScripts.spawnCrawler(config.crawl_script, config.master_addr, config.client_name, config.script_path, config.headless, config.disable_proxy, config.proxy_host, config.proxy_port, config.client_name, waitingTime); //hier war socket.id
    console.log("starting test run");

  }else {

    if (!/^(?:f|ht)tps?\:\/\//.test(data)) {
      url = "http://" + data;
    } else {
      url = data;
    }  

    spawnedScripts.spawnCrawler(config.crawl_script, url, config.client_name, config.script_path, config.headless, config.disable_proxy, config.proxy_host, config.proxy_port, "False", waitingTime);

  } 

})

socket.on("killchildprocess", data => {

  if(data.toString() === "timeout"){
    console.log("Browser timed out");

  }else{
    console.log("Crawl cancelled at master");

  }   
  spawnedScripts.killCrawler();

});

socket.on("browsergo", data => {
  
  ls.stdin.write("visiturl\n");
});

socket.on("waitingtime", data => {

  waitingTime = data;
  console.log("Calibration done: Waiting " +waitingTime +" ms before each website visit.");
});
