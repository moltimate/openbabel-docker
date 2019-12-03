const express = require('express');
const crypto = require('crypto');
var execFile = require('child_process').execFile;
var exec = require('child_process').exec;
const app = express();
var formidable = require('formidable');
var path = require('path');
var fs = require('fs');

app.use(express.json())
app.get('/v1/obabel', (req, res) => {
    
    name = req.query.storage_hash;
    full_path = path.join(__dirname, name + '.pdbqt');
    res.sendFile(full_path);
});

app.post('/v1/obabel', (req, res) => {
    molecules = []
    fields = {}
    var form = new formidable.IncomingForm();
    form.multiples = true;
    form.parse(req);
    form.on('field', function(name, value) {
        fields[name] = value
    })
    form.on('fileBegin', function (name, file){
        let nameHash = crypto.createHmac('sha1', crypto.randomBytes(48))
        .update(Date.now()
        .toString())
        .digest('hex')
        if (name.startsWith('molecule')) {
            molecule = {}
            molecule.originalName = name
            molecule.name = nameHash
            molecules.push(molecule)
        }
        else {
            res.status(400);
            res.send('Unknown file name parameter: ' + name);
        }
        full_path = path.join(__dirname,'uploads', nameHash + '.pdb');
        file.path = full_path;
    });
    form.on('end', function() {
        try {
            var args = []
            var options = []
            args.push('-m');
            args.push('-ipdb');
            for(molecule of molecules){
                
                molecule_path = path.join(__dirname,'uploads',molecule.name + '.pdb')
                
                args.push('"' + molecule_path + '"');
                
                exec("chmod +x " + molecule_path);
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
                });
                res.status(200)
                res.send(molecules[0].name)
                
            }
            catch(error) {
                res.status(500)
                res.send('Execution error: ' + error)
            }
        }
        catch(err) {
            res.status(400)
            res.send('Incorrect arguments provided.')
            console.log(err)
        }
        
    });

});

app.listen(8000, () => {
    console.log('Listening on port 8000.')
})