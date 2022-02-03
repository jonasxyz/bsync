const puppeteer = require('puppeteer');

//[0,1] = script path and location
var url = process.argv.slice(2,3);
var host = process.argv.slice(4,5);
var port = process.argv.slice(5,6);
var userAgent = process.argv.slice(6,7).toString();;
var waitingTime = Math.floor(process.argv.slice(7,8));;

var proxyArg;

(async () => {
    
    if (host.toString() !== "False" ){
        proxyArg = "--proxy-server="+host+":"+port.toString();
        console.log("proxy set to "+host+":"+port );
    }else  proxyArg = "";

    if (process.argv.slice(3,4).toString() === 'true' ){
        var headless = true;
    } else var headless = false;

    const browser = await puppeteer.launch({
        headless: headless,
        ignoreHTTPSErrors: true,
        args:[proxyArg] 
    });
 

    const page = await browser.newPage();

    if (userAgent!== "False"){
        await page.setUserAgent(userAgent);
        console.log("useragent set to: "+ userAgent);
    } 

    // send signal that browser is ready for visiting website
    process.stdout.write("browserready")


    process.stdin.on("data", async(data)=> {

        if(data.toString().includes("visiturl")){
            console.log("All browser ready. Start visting "+ url);

            //waiting
            if(waitingTime > 0){
                console.log("waiting " + waitingTime +" ms");
                await new Promise(resolve => setTimeout(resolve, waitingTime));
            } 
            
            await page.goto(url.toString());

            await page.waitForTimeout(1000);
          
            //console.log("ich bin ein puppetier hrr")

            await browser.close();

            process.stdout.write("urldone"); //new


            process.exit();

        }
        
    });
    
})();
