const express = require('express');
const crypto = require('crypto');

var AWS = require('aws-sdk');
//UNCOMMENT FOR LOCAL TESTING ADD config.json file with your AWS access and secret key here 
//AWS.config.loadFromPath('./config.json');

var execFile = require('child_process').execFile;
var exec = require('child_process').exec;
const app = express();
var formidable = require('formidable');
var path = require('path');
var fs = require('fs');
var archiver = require('archiver');

// GCS usage defined by environment variable
const useCloudStorage = true//process.env.CLOUD_STORAGE == "true"; //process.env.CLOUD_STORAGE=="true";
const bucket = "openbabel-prod"; //set the bucket that aws s3 storage should be using (bucket needs to already exist)

var s3 = new AWS.S3({apiVersion: '2006-03-01'});

//path defining the local directory files are saved to
//__dirname = the current working directory local /cloud)
console.log('__dirname', __dirname);
const uploadsPath = path.join(__dirname,'uploads');
console.log('uploadsPath', uploadsPath);

const checkExists = function(filepath, callback) {
  if (useCloudStorage) {
    var params = {
      Bucket: bucket, 
      MaxKeys: 30
     };
     s3.listObjectsV2(params, function(err, data) {
       if (err) callback(err, null); // an error occurred how to return an error?
       else {
          //aws doesn't do file/folder structure it's just a list of things in the bucket
          data['Contents'].map(obj => { if(obj.Key == filepath) callback(null, data); });
          return callback(null, null); //file doesn't exist
        }
     });
  }
  else {
    // For local storage, prepend the upload directory path when checking files
    return callback(null, fs.existsSync(path.join(uploadsPath, filepath)));
  }
}

//get request to see if a job is done and getting the results
app.use(express.json())
app.get('/v1/obabel', (req, res) => {
  //identifier for this particular file conversion job
  let jobId = req.query.storage_hash;
  console.log('response', res);
  if(jobId == null || jobId == undefined) {
    console.log('jobId = null or undefined');
    res.status(400);
    return res.send('Missing Job Id');
  }
  console.log('jobId', jobId);
  
  //the full path of the file to be saved
  let jobPath = path.join(jobId+"/");
  console.log('jobPath', jobPath);
  
  //the path of the zipped response file
  let responsePath = useCloudStorage ? path.join(jobId,'response.zip') : jobId +'.zip';
  console.log('responsePath', responsePath);
  //Keep track of whether a response has been sent to avoid sending a
  //redundant response
  let responseIsSent = false;
  //see if the folder exists to get the response
  //see if the response.zip exists to send response as result
  //call to find if the path and job exists/is active
    checkExists(responsePath, (err, exists) => {
      if (err) {
        res.status(500);
        responseIsSent = true;
        return res.send(err);
      }
      else if (exists) {
        try{
          //trying to read the job
          let output=null;
          if (useCloudStorage) {
           output = s3.getObject({ Bucket: bucket, Key: responsePath }).createReadStream().on('error', error => {
              console.log(err);
              res.status(500);
              return res.send("Could not retrieve job from storage: " + err);
            });
          }
          else {
            output = fs.createReadStream(path.join(uploadsPath, jobId+'.zip'));
          }
          //return success code 200, with a zip file of the response from the storage  
          res.writeHead(200, {
            'Content-Type': 'application/zip'
          });
          output.pipe(res);

        } catch(err) {
          console.log(err)
          res.status(500);
          return res.send("Could not retrieve job from storage: "+err);
        }
      }
      
    });
});

//main entry point for a post request to convert a pdb file to pdbqt file
app.post('/v1/obabel/toPDBQT', (req, res) => {
  return openbabelFileConversion(req, res,'result.pdbqt')
});

//main entry point for a post request to convert a pdbqt file to a pdb file
app.post('/v1/obabel/toPDB', (req, res) => {
  return openbabelFileConversion(req, res,'result.pdb')
});

/**
 * handles logic for an obabel file conversion endpoint. Performs the following actions:
 *  
 *  1. Creates a random job ID
 *  2. Creates a folder for the job named after the ID
 *  3. Executes openbabel with the received molecules as inputs
 *  4. Sends a response with the job ID
 * 
 * @param {Object} req - Request object received at an Express endpoint
 * @param {Object} res - Response object returned from Express endpoint
 * @param {String} outputName - The name of file to be output
 * @param {String[]} [options]  - A list of obabel option flags to follow output file path (ex: "--addinindex", "-m")
 * @param {String} [inputFileType] - the name of the file type to expect as input (ex: "pdb", "pdbqt", "sdf")
 * @param {String} [outputFileType] - the name of the file type to output (ex: "pdb", "pdbqt", "sdf")
 * 
 */
function openbabelFileConversion(req, res, outputName, options = [], inputFileType, outputFileType){
  let molecules = []
  let fields = {}
  
  let responseIsSent = false;
  let form = new formidable.IncomingForm();

  //create a random name for the directory
  let nameHash = crypto.createHmac('sha1', crypto.randomBytes(48))
    .update(Date.now()
    .toString())
    .digest('hex');

  //combine the path and the hash to find the file/directory for the local/aws storage
  let jobPath = path.join(nameHash+"/");
  let directoryPath = path.join(uploadsPath, jobPath);
  
  // Ensure there is no hash collision
  checkExists(path.join(jobPath, "response.zip"), (err, exists) => {
    if (err || exists) {
      if(!responseIsSent) {
        res.status(500);
        res.send("Storage Error. Please try again.");
        responseIsSent = true;
      }
    }
    // Make the storage space for the job
    fs.mkdirSync(directoryPath);

    if (useCloudStorage) {
      var objectParams = {Bucket: bucket, Key: jobPath, Body: ''};
      // Create object upload promise
      var uploadPromise = s3.putObject(objectParams).promise();
      uploadPromise.then(
        function(data) {
          console.log("Successfully uploaded data to " + bucketName + "/" + keyName);
        }).catch(error => {
          console.log(err);
          if(!responseIsSent) {
            res.status(500)
            res.send('Error storing result')
            responseIsSent = true;
          }
        });
    }

    form.multiples = true;
    form.parse(req);
    form.on('field', function(name, value) {
      fields[name] = value
    })
    
    form.on('fileBegin', function (name, file){
      //each field in the form whose name starts with "molecule"
      if (name.startsWith('molecule')) {
        let molecule = {}
        molecule.name = file.name
        molecules.push(molecule)
      }

      let fullPath = path.join(directoryPath, file.name);
      file.path = fullPath;
    });

    form.on('end', function() {
      try {
        //arguments for openbabel
        let args = []
        let execOptions = [] 
      
        //add an input filetype to the command if one was supplied
        if(inputFileType){
          args.push(`-i${inputFileType}`)
        }

        //add the paths to each of the submitted molecules
        for(molecule of molecules){
          let molecule_path = path.join(directoryPath, molecule.name )
          args.push('"' + molecule_path + '"');
        }
      
        //add an output filetype to the command if one was supplied
        if(outputFileType){
          args.push(`-o${outputFileType}`)
        }
        
        let outputFilePath = '';
        //set the output file name and type
        outputFilePath = path.join(directoryPath,outputName)
        
        args.push(`-O${outputFilePath}`);
        
        //add all specified options to the command
        for(option of options){
          args.push(option);
        }
      
        if(fields.options)
        args.push(fields.options);

        try {
          obable_program = path.join(__dirname, "obabel");

          execOptions = {};
          execOptions.shell = true;
          
          //execute the obabel binary
          exec("obabel " + args.join(' '), execOptions, function(error, stdout, stderr) {
            callback = (error) => {
              if(!responseIsSent) {
                res.status(500)
                res.send('Execution error: ' + error)
                responseIsSent = true;
              }            
            }
            //write all files locally
            let outputTextPath = path.join(directoryPath, "obabel-output.txt");
            
            fs.writeFileSync(outputTextPath, stdout, callback);
            fs.appendFileSync(outputTextPath, stderr, callback);
            fs.appendFileSync(outputTextPath, error, callback);

            // Package job files for storage and retrieval
            
            //create local writer stream and write
            let outputPath = path.join(uploadsPath, nameHash+'.zip');
            let output = fs.createWriteStream(outputPath);

            let archive = archiver('zip', {
              zlib: { level: 9 }
            });
            archive.on('error', function (err) {
              if(!responseIsSent){
                res.status(500);
                console.log(err)
                responseIsSent = true;
                return res.send('File archiving error.');
              }
            });
            //setting where the archive data will go to (file path)
            archive.pipe(output);

            try{
              archive.directory(directoryPath, "", { name: nameHash })
              archive.finalize();

            } catch(error) {
              console.log(error);
              if(!responseIsSent) {
                res.status(500)
                res.send('Execution error: ' + error)
                responseIsSent = true;
              }
            }
            output.on('close', () => 
            {
              if(useCloudStorage) {
                
                let stream = fs.createReadStream(outputPath);
                var params = {Bucket: bucket, Key: path.join(jobPath, "response.zip"), Body: stream};
                //write the response to the response.zip file folder and create write stream (or just upload the response?)
                s3.upload(params, function(err, data) {
                    if(err) {
                      if(!responseIsSent) {
                        res.status(500)
                        res.send('Saving Response Error ' + error)
                        responseIsSent = true;
                      }  
                    } else {
                      fs.rmdir(directoryPath, {recursive:true}, (err) => {
                        if (err)
                        console.error("Unable to remove local job directory "+err);
                      });
                    }
                });
              }

            })
          });
          
          if(!responseIsSent) {
            res.status(200)
            res.send(nameHash)
            responseIsSent = true;
          }
          
        }
        catch(error) {
          //avoid double-sending
          if(!responseIsSent) {
            res.status(500)
            res.send('Execution error: ' + error)
            responseIsSent = true;
          }
        }
      }
      catch(err) {
        //avoid double-sending
        if(!responseIsSent) {
          res.status(400)
          res.send('Incorrect arguments provided.')
          responseIsSent = true;
        }
      }    
    })
  })
}

app.listen(8000, () => {
  console.log('Listening on port 8000.')
})