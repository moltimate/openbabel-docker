const express = require('express');
const crypto = require('crypto');
var execFile = require('child_process').execFile;
var exec = require('child_process').exec;
const app = express();
var formidable = require('formidable');
var path = require('path');
var fs = require('fs');
var archiver = require('archiver')

app.use(express.json())
app.get('/v1/obabel', (req, res) => {
  //identifier for this particular file conversion job
  let jobId = req.query.storage_hash;
  //path defining the directory the file is to be saved to
  let uploadsPath = path.join(__dirname,'uploads');
  //the full path of the file to be saved
  let fullPath = path.join(__dirname,"uploads", jobId);
  //the full file path of the file to store openbabel's output text
  let obabelOutputFilePath = path.join(fullPath,'obabel-output.txt');
  //Keep track of whether a response has been sent to avoid sending a
  //redundant response
  let responseIsSent = false;
  
  if (!fs.existsSync(fullPath)) {
    res.status(400);
    responseIsSent = true;
    return res.send('No job with that ID.');
    
  }else if (!fs.existsSync(obabelOutputFilePath)) {
    res.status(300);
    responseIsSent = true;
    return res.send('Job still processing.');
      
  } else {

    let outputPath = path.join(uploadsPath, jobId + '.zip');
    let output = fs.createWriteStream(outputPath);
    
    let archive = archiver('zip', {
      zlib: { level: 9 }
    })
    
    output.on('close', function () {
      let stat = fs.statSync(outputPath);
      if(!responseIsSent){
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': stat.size
        });
        let readStream = fs.createReadStream(outputPath);
        readStream.pipe(res)
      }
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
    console.log(jobId);
    
    try{
      archive.directory(fullPath, "", { name: jobId })
      archive.finalize();
    } catch(error) {
      console.log(error)
    }
  }
});

app.post('/v1/obabel/toPDBQT', (req, res) => {
  return openbabelFileConversion(req, res,'result.pdbqt',["-xr"])
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
  
  form.multiples = true;
  form.parse(req);
  form.on('field', function(name, value) {
    fields[name] = value
  })
  
  //create a random name for the directory
  let nameHash = crypto.createHmac('sha1', crypto.randomBytes(48))
    .update(Date.now()
    .toString())
    .digest('hex');
    
  let directoryPath = path.join(__dirname,'uploads', nameHash)
  let uploadsPath = path.join(__dirname,'uploads')
  
  //Check for naming collisions
  if (!fs.existsSync(directoryPath)) {
    //create the new directory
    fs.mkdirSync(directoryPath);
  }
  else if(!responseIsSent) {
    res.status(500);
    res.send("Storage Error. Please try again.");
    responseIsSent = true;
  }
  
  form.on('fileBegin', function (name, file){
    //each field in the form whose name starts with "molecule"
    if (name.startsWith('molecule')) {
      molecule = {}
      molecule.name = file.name
      molecules.push(molecule)
    }

    fullPath = path.join(directoryPath, file.name);
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
        molecule_path = path.join(directoryPath,molecule.name )
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
      for(let option in options){
        args.push(option);
      }

      try {
        obable_program = path.join(__dirname, "obabel");

        execOptions = {};
        execOptions.shell = true;
        
        console.log(args.toString())
        
        //execute the obabel binary
        exec("obabel " + args.join(' '), execOptions, function(error, stdout, stderr) {
          callback = (error) => {
            if(!responseIsSent) {
              res.status(500)
              res.send('Execution error: ' + error)
              responseIsSent = true;
            }            
          }
          outputTextPath = path.join(directoryPath, "obabel-output.txt")
          fs.writeFile(outputTextPath, stdout, callback)
          fs.appendFile(outputTextPath, stderr, callback)
          fs.appendFile(outputTextPath, error, callback)
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
}

app.listen(8000, () => {
  console.log('Listening on port 8000.')
})