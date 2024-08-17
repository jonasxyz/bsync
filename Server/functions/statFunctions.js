var sumDelay = 0;
var highestDelay= 0;
var countRequestDelayOver1000 = 0;

module.exports ={

    calcHttpDelayV2 : function (myArray, urlsDone){

        let iterationRequestDelay = myArray[0].maxDelayArray[0];
        sumDelay += iterationRequestDelay;
        
        if (iterationRequestDelay > 1000) countRequestDelayOver1000 += 1;
        if (highestDelay < iterationRequestDelay) highestDelay = iterationRequestDelay;
    
    
        console.log("INFO: " + "Delay between first and last HTTP Request " + iterationRequestDelay +" ms. Average delay between first and last HTTP request from "
        +urlsDone + " runs is " + Math.round(sumDelay/(urlsDone)) + " ms");

        console.log("INFO: " + "Highest delay is " + highestDelay + " ms. " + countRequestDelayOver1000 + " iterations with delay over 1 second");

         
    },

    getMaxDelay : function ( array, iterations) {

        var fastestReq = array[0].requestArray[iterations]; 
        var slowestReq = array[0].requestArray[iterations];

        for (let i = 0; i < array.length; ++i) {
    
            if (array[i].requestArray[iterations] > slowestReq) {
                slowestReq = array[i].requestArray[iterations];
            }
            if (array[i].requestArray[iterations] < fastestReq) {
                fastestReq = array[i].requestArray[iterations];
            }  
            
        }

        return slowestReq - fastestReq;

    },

    insertMaxDelay : function (array, maxDelay){

        array.forEach(element => {
            element.maxDelayArray.push(maxDelay);
            // element.maxDelayArray.splice(iterations,0, maxDelay);

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

    flushArray : function(array, calibrationDone) {
        array.forEach(element => { 
            element.dateArray =[];
            element.readyArray =[];
            element.requestArray =[];
            element.doneArray =[];
            element.maxDelayArray =[];
            element.errorArray =[];
            element.browserFinishedArray =[];

            if(calibrationDone) element.waitingTimeArray =[];
            
        });

    }

}
