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
    var jobId = req.query.storage_hash;
    //path defining the directory the file is to be saved to
    var uploadsPath = path.join(__dirname,'uploads');
    //the full path of the file to be saved
    var fullPath = path.join(__dirname,"uploads", jobId);
    //the full file path of the file to store openbabel's output text
    var obabelOutputFilePath = path.join(fullPath,'obabel-output.txt');
    //Keep track of whether a response has been sent to avoid sending a
    //redundant response
    var responseIsSent = false;
    
    if (!fs.existsSync(fullPath)) {
        res.status(400);
        responseIsSent = true;
        return res.send('No job with that ID.');
        
    }else if (!fs.existsSync(obabelOutputFilePath)) {
        res.status(300);
        responseIsSent = true;
        return res.send('Job still processing.');
        
    } else {
    
        var outputPath = path.join(uploadsPath, jobId + '.zip');
        var output = fs.createWriteStream(outputPath);
        var archive = archiver('zip', {
            zlib: { level: 9 }
        })
        output.on('close', function () {
            var stat = fs.statSync(outputPath);
            if(!responseIsSent){
                res.writeHead(200, {
                    'Content-Type': 'application/zip',
                    'Content-Length': stat.size
                });
                var readStream = fs.createReadStream(outputPath);
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

app.post('/v1/obabel', (req, res) => {
    molecules = []
    fields = {}
    
    var responseIsSent = false;
    var form = new formidable.IncomingForm();
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
            molecule.name = name
            molecules.push(molecule)
        }

        fullPath = path.join(directoryPath, name);
        file.path = fullPath;
    });
    form.on('end', function() {
        try {
            //arguments for openbabel
            var args = []
            var options = []
            //include metadata in the file
            args.push('-m');
            //set the input file type to pdb
            args.push('-ipdb');
            //add each of the  
            for(molecule of molecules){
                
                molecule_path = path.join(directoryPath,molecule.name )
                
                args.push('"' + molecule_path + '"');
                
            }
            //set the output file type to pdbqt
            args.push('-opdbqt');
            try {
                obable_program = path.join(__dirname, "obabel");

                options = {};
                options.shell = true;
                
                //execute the obabel binary
                execFile("obabel", args, options, function(error, stdout, stderr) {
                    console.log(stdout)
                    console.log(stderr)
                    console.log(error) 
                    
                    callback = (error) => {
                        if(!responseIsSent) {
                            res.status(500)
                            res.send('Execution error: ' + error)
                            responseIsSent = true;
                        }
                        
                    }
                    outputTextPath = path.join(directoryPath,'obabel-output.txt')
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
            console.log(err)
        }    
    })
});

app.listen(8000, () => {
    console.log('Listening on port 8000.')
})