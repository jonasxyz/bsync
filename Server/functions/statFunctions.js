
var helperFunctions = require('./helper.js');


var sumDelay = 0;
var highestDelay= 0;
var countRequestDelayOver1000 = 0;

module.exports ={

    calcHttpDelayV2 : function (myArray, urlsDone){

        let iterationRequestDelay = myArray[0].maxDelayArray[urlsDone-1];
        sumDelay += iterationRequestDelay;
        
        if (iterationRequestDelay > 1000) countRequestDelayOver1000 += 1;
        if (highestDelay < iterationRequestDelay) highestDelay = iterationRequestDelay;
    
    
        console.log("INFO: " + "Delay between first and last HTTP Request " + iterationRequestDelay +" ms. Average delay between first and last HTTP request from "
        +urlsDone + " runs is " + Math.round(sumDelay/(urlsDone)) + " ms");

        console.log("INFO: " + "Highest delay is " + highestDelay + " ms. " + countRequestDelayOver1000 + " iterations with delay over 1 second");

         
    },

    insertTime: function (arrayStatistics, arrayClients, clientname, timeUrlSent, urlsDone) {

        let i = helperFunctions.searchArray(arrayStatistics, clientname.toString(), 1);
        // inserting time it took from sending url over visiting the url to closing the browser
        arrayStatistics[i].doneArray.push((Date.now() - timeUrlSent));

        //let w = searchArray(arrayClients, clientname.toString(), 4);
        // console.log("wT ", w.toString())

        arrayStatistics[i].waitingTimeArray.push( helperFunctions.searchArray(arrayClients, clientname.toString(), 3) );

        // arrayStatistics[i].maxDelayArray.push(module.exports.getMaxDelay(false, arrayStatistics, urlsDone));

        // bei einem fehlt immer maxdelay, mir ist aufegefallen dass im gegensartz zu delay bei calibration insert time bei jedem urldone aufgerufen wird.

        // habs der will das ganze array durchlafen wenn noch gar nicht alle requests drin sind



        // neu 01.2 date request und maxdelay sind nach timeout undefined
        // datearray und request array haben nicht die richtige länge - mal bei readyarray schauen wie ich das gemacht habe
        // waiting time wird beim schnellsten gar nicht hinzugefügt
        // donearray ist eins zu viel bei allen die nicht timed out sind
    },
    
    getMaxDelay : function ( array, iterations) {

     
        // if (calibration==false){
        //     var statMax = array[0].requestArray[iterations]; //war bei beiden 0 statt i
        //     var statMin = array[0].requestArray[iterations];
        //     //let i = searchArray(array, clientname, 3);
        // }else{
        //     var statMax = array[0].requestArray[iterations]; //war bei beiden 0 statt i
        //     var statMin = array[0].requestArray[iterations];
        //     //let i = searchArray(array, clientname, 1);

        // }
        
        // }
    
        var fastestReq = array[0].requestArray[iterations]; //war bei beiden 0 statt i
        var slowestReq = array[0].requestArray[iterations];

        for (let i = 0; i < array.length; ++i) {
    
            if (array[i].requestArray[iterations] > slowestReq) {
                slowestReq = array[i].requestArray[iterations];
            }
            if (array[i].requestArray[iterations] < fastestReq) {
                fastestReq = array[i].requestArray[iterations];
            }  
            
        }
        // console.log("MAXDELAY "+ (slowestReq - fastestReq)); //debug

        return slowestReq - fastestReq;

        
        // for (let i = 0; i < array.length; ++i) {
    
        //     if (calibration==false) {
        //         if (array[i].requestArray[iterations] > statMax) {
        //             statMax = array[i].requestArray[iterations];
        //         }
        //         if (array[i].requestArray[iterations] < statMin) {
        //             statMin = array[i].requestArray[iterations];
        //         }
        //     } else {
        //         if (array[i].requestArray[iterations] > statMax) {
        //             statMax = array[i].requestArray[iterations];
        //         }
        //         if (array[i].requestArray[iterations] < statMin) {
        //             statMin = array[i].requestArray[iterations];
        //         }
        //     }
        // }
    
        // return statMax - statMin;
        //console.log("max delay = ",statMax - statMin)
        // array[i].maxDelayArray[iterations] = statMax - statMin;
        //let maxDelayArray = max - min;
        ///
    },

    insertMaxDelay : function (array, maxDelay, iterations){

        array.forEach(element => {
            // element.maxDelayArray.push(maxDelay);
            element.maxDelayArray.splice(iterations,0, maxDelay);

        });

    },
    removeExtraStats: function (array, iterations, calibrationDone){


        array.forEach(element => { 
            if (element.dateArray.length - 1 == iterations){ 
                // console.log(element.workerName + "dateArray -1 " +element.dateArray[iterations-1] );
                element.dateArray.pop();
            } 
            if (element.readyArray.length - 1 == iterations){ 
                // console.log(element.workerName + "readyArray -1 " +element.readyArray[iterations-1] );
                element.readyArray.pop();
            }
            if (calibrationDone) {
                if (element.waitingTimeArray.length - 1 == iterations) {
                    // console.log(element.workerName + "waitingTimeArray -1 " + element.waitingTimeArray[iterations - 1]);
                    element.waitingTimeArray.pop();
                }
            }
            
            if (element.requestArray.length - 1 == iterations){ 
                // console.log(element.workerName + "requestArray -1 " +element.requestArray[iterations-1] );
                element.requestArray.pop();
            } 
            if (element.doneArray.length - 1 == iterations){ 
                // console.log(element.workerName + "doneArray -1 " +element.doneArray[iterations-1] );
                element.doneArray.pop();
            } 
            
        });

    },

    flushCalibrationArray : function(array) {
        array.forEach(element => { 
            element.dateArray =[];
            element.readyArray =[];
            element.requestArray =[];
            element.doneArray =[];
            element.maxDelayArray =[];
            
        });

    }

}
