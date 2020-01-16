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
    responseIsSent = false;
    jobId = req.query.storage_hash;
    uploadsPath = path.join(__dirname,'uploads');
    fullPath = path.join(__dirname,"uploads", jobId);
    
    obabelOutputFilePath = path.join(fullPath,'obabel-output.txt')
    if (!fs.existsSync(fullPath) && !responseIsSent) {
        res.status(400);
        responseIsSent = true;
        return res.send('No job with that ID.');
        
    }else if (!fs.existsSync(obabelOutputFilePath) && !responseIsSent) {
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
    
    responseIsSent = false;
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
            var args = []
            var options = []
            args.push('-m');
            args.push('-ipdb');
            for(molecule of molecules){
                
                molecule_path = path.join(directoryPath,molecule.name )
                
                args.push('"' + molecule_path + '"');
                
            }
            args.push('-opdbqt');
            try {
                obable_program = path.join(__dirname, "obabel");

                options = {};
                options.shell = true;
                
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
                if(!responseIsSent) {
                    res.status(500)
                    res.send('Execution error: ' + error)
                    responseIsSent = true;
                }
            }
        }
        catch(err) {
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