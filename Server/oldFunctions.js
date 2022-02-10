async function receivedRequests(){

    console.log(pendingJobs);

    return new Promise((resolve, reject) => {
		if (pendingRequests >= 0 || pendingJobs >= 0) {
			return reject();
		}else{
            return resolve();
        }
        // if (pendingRequests == 0 && pendingJobs == 0) {
		// 	return reject();
		// }else{
        //     return resolve();
        // }
		
	});
    
}

// insertTime: function (arrayStatistics, arrayClients, clientname, timeUrlSent, urlsDone) {

//     let i = helperFunctions.searchArray(arrayStatistics, clientname.toString(), 1);
//     // inserting time it took from sending url over visiting the url to closing the browser
//     arrayStatistics[i].doneArray.push((Date.now() - timeUrlSent));

//     //let w = searchArray(arrayClients, clientname.toString(), 4);
//     // console.log("wT ", w.toString())

//     arrayStatistics[i].waitingTimeArray.push( helperFunctions.searchArray(arrayClients, clientname.toString(), 3) );

//     // arrayStatistics[i].maxDelayArray.push(module.exports.getMaxDelay(false, arrayStatistics, urlsDone));

//     // bei einem fehlt immer maxdelay, mir ist aufegefallen dass im gegensartz zu delay bei calibration insert time bei jedem urldone aufgerufen wird.

//     // habs der will das ganze array durchlafen wenn noch gar nicht alle requests drin sind



//     // neu 01.2 date request und maxdelay sind nach timeout undefined
//     // datearray und request array haben nicht die richtige länge - mal bei readyarray schauen wie ich das gemacht habe
//     // waiting time wird beim schnellsten gar nicht hinzugefügt
//     // donearray ist eins zu viel bei allen die nicht timed out sind
// },