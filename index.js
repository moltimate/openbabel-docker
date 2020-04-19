const express = require('express');
const crypto = require('crypto');
const {Storage} = require('@google-cloud/storage');
var execFile = require('child_process').execFile;
var exec = require('child_process').exec;
const app = express();
var formidable = require('formidable');
var path = require('path');
var fs = require('fs');
var archiver = require('archiver');

// GCS usage defined by environment variable
const useCloudStorage = process.env.CLOUD_STORAGE=="true";
const bucket = "obabel-production";
const storage = new Storage();

//path defining the local directory files are saved to
const uploadsPath = path.join(__dirname,'uploads');

const checkExists = function(filepath, callback) {
  if (useCloudStorage) {
    return storage.bucket(bucket).file(filepath).exists(callback);
  }
  else {
    // For local storage, prepend the upload directory path when checking files
    return callback(null, fs.existsSync(path.join(uploadsPath, filepath)));
  }
}

app.use(express.json())
app.get('/v1/obabel', (req, res) => {
  //identifier for this particular file conversion job
  let jobId = req.query.storage_hash;
  
  //the full path of the file to be saved
  let jobPath = path.join(jobId+"/");
  
  //the path of the zipped response file
  let responsePath = useCloudStorage ? path.join(jobId,'response.zip') : jobId+'.zip';
  
  //Keep track of whether a response has been sent to avoid sending a
  //redundant response
  let responseIsSent = false;
  
  checkExists(jobPath, (err, exists) => {
    if (err) {
      res.status(500);
      responseIsSent = true;
      return res.send(err);
    }
    else if (exists) {
      checkExists(responsePath, (err, exists) => {
        if (err) {
          res.status(500);
          responseIsSent = true;
          return res.send(err);
        }
        else if (exists) {
          try{
            let output=null;

            if (useCloudStorage) {
              output = storage.bucket(bucket).file(responsePath).createReadStream();
            }
            else {
              output = fs.createReadStream(path.join(uploadsPath, jobId+'.zip'));
            }
  
            res.writeHead(200, {
              'Content-Type': 'application/zip'
            });
            output.pipe(res);

          } catch(err) {
            console.log(err)
            res.status(500);
            res.send("Could not retrieve job from storage: "+err);
          }
        }
        else {
          res.status(300);
          responseIsSent = true;
          return res.send('Job still processing.');
        }
      })
    }
    else {
      res.status(400);
      responseIsSent = true;
      return res.send('No job with that ID.');
    }
  });
});

app.post('/v1/obabel/toPDBQT', (req, res) => {
  return openbabelFileConversion(req, res,'result.pdbqt')
});

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

  let jobPath = path.join(nameHash+"/")
  let directoryPath = path.join(uploadsPath, jobPath)
  
  // Ensure there is no hash collision
  checkExists(jobPath, (err, exists) => {
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
      storage.bucket(bucket).file(jobPath).save('', {resumable:false}, (err) => {
        if (err) {
          console.log(err);
          if(!responseIsSent) {
            res.status(500)
            res.send('Error storing result')
            responseIsSent = true;
          } 
        }
      })
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
          let molecule_path = path.join(directoryPath,molecule.name )
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
            let outputTextPath = path.join(directoryPath, "obabel-output.txt")
            fs.writeFile(outputTextPath, stdout, callback)
            fs.appendFile(outputTextPath, stderr, callback)
            fs.appendFile(outputTextPath, error, callback)

            // Package job files for storage and retrieval
            let output = null;

            if (useCloudStorage) {
              output = storage.bucket(bucket).file(path.join(jobPath, "response.zip")).createWriteStream({resumable:false});
              output.on('finish', () => {
                fs.rmdir(directoryPath, {recursive:true}, (err) => {
                  if (err)
                  console.error("Unable to remove local job directory "+err);
                });
              })
            }
            else {
              let outputPath = path.join(uploadsPath, nameHash+'.zip');
              output = fs.createWriteStream(outputPath);
            }

            let archive = archiver('zip', {
              zlib: { level: 9 }
            })
            
            archive.on('error', function (err) {
              if(!responseIsSent){
                res.status(500);
                console.log(err)
                responseIsSent = true;
                return res.send('File archiving error.');
              }
            })

            archive.pipe(output)
            
            try{
              archive.directory(directoryPath, "", { name: nameHash })
              archive.finalize();
            } catch(error) {
              console.log(error)
            }
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