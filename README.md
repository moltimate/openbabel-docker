# openbabel-docker
The components necessary to build a docker container running an instance of 
openbabel with its own HTTP API. This container has the ability to use 
cloud storage space on AWS using an S3 bucket or just run locally (see 
steps below)

### Contents

* [Setup & Run](#setup-run)
* [API Summary](#api-summary)
* [API Details](#api-details)


<a name="setup-run"></a>
### Setup & Run

#### Configure Local or AWS usage of an OpenBabel Container
When running the container on your own machine (vs. AWS ECS instance)

If you would like the OpenBabel responses stored on AWS you need to configure a few things:
1. Obtain your access key and secret access key from your AWS organization.
2. Create a "config.json" file in the top level of this directory to contain your access key and secret access key.
    This is a json formatted file for example:
    { "accessKeyId":"<<ACCESS KEY>>", "secretAccessKey": "<<SECRET ACCESS KEY>>", "region": "<<AWS REGION>>" }
2. On your AWS account make sure you have access to your S3 bucket
3. In the index.js file, uncomment AWS.config.loadFromPath('./config.json');  towards the top of the file
4. Make sure the global variable, useCloudStorage, declared with the other initializations, is set to true.
5. Set the variable bucket = "<<Your s3 Bucket Name>>"
5. Create and Run Docker Image following steps below.

If you would like OpenBabel to not store responses on AWS and would prefer just they 
stored locally in the container (removes need for AWS):
1. Set useCloudStorage to false
2. Comment out (if not already) AWS.config.loadFromPath('./config.json'); towards the top of the file.



#### Docker Toolbox

First, build a docker image from the root directory of the openbabel-docker
source code.

   ```docker image build -t [name for the docker image] [location of the openbabel-docker directory]```

After the image has been generated, create a container. This container should
have port 8000 exposed.

    ```docker run -p [external port to be hit]:8000 [name of the docker image]```
    
    external port to be hit can be set if 8000 is already being used wherever you are running it. (Docker routes to your
    docker port for the container)
Users can now interact with the instance of Open Babel in the docker container. The following output should appear:

    ```
    > autodock@0.0.1 start /opt/obabel
    > node index.js

    Listening on port 8000.
    ```
    
To interact with the API for the container, find the ip address of the docker host machine with the following command:

    ```docker-machine ip```
    
The displayed IP will be the address to send http requests to, along with the external port chosen when creating the container.


When deploying the container to AWS ECS instance:
Remove reference to: (Comment it out or remove it completely)
    ```AWS.config.loadFromPath('./config.json');``` 
    the IAM role of your ECS instance needs to have access to read and write the specific s3 bucket you are using.


<a name="api-summary"></a>
### API Summary

This briefly summarizes all API endpoints.

| HTTP Method | Endpoint | Function |
|:------------|:---------|:---------|
| POST | [/v1/obabel/toPDB](#post-pdb) | Submits .pdbqt files for combination and conversion to pdb file format |
| POST | [/v1/obabel/toPDBQT](#post-pdbqt) | Submits files for conversion to pdbqt file format |
| GET | [/v1/obabel/{storage_hash}](#get-obabel) | Returns a zip file of pdbqt files that were previously submitted as .pdb files |


<a name="api-details"></a>
### API Details

This outlines the API's endpoints, request types, and expected request parameters or JSON payload.

<a name="post-pdb"></a>
##### POST /v1/obabel/toPDB
###### Submits .pdbqt files for combination and conversion to pdb file format
 
Request body parameters

| Parameter | Type | Function |
|:----------|:-----|:---------|
| molecule_n | form data | A file to be converted. A .pdbqt file is expected, and will be converted to a .pdb file. Note that any number of molecules can be given, keyed "molecule_1," "molecule_2," etc. If a ligand and a macromolecule are given, they will be combined into a single output file|
| options | form data | String of additional options to pass to OpenBabel at runtime. Optional. |

Output

Returns a storage hash value which is used to retrieve the converted files. (status: 200)
 
<a name="post-pdbqt"></a>
##### POST /v1/obabel/toPDB
###### Submits a number of molecule files to Open Babel for conversion to .pdbqt format
 
Request body parameters

| Parameter | Type | Function |
|:----------|:-----|:---------|
| molecule_n | form data | A file to be converted. By default a .pdb file is expected, and will be converted to a .pdbqt file. Note that any number of molecules can be given, keyed "molecule_1," "molecule_2," etc.|
| options | form data | String of additional options to pass to OpenBabel at runtime. Optional. |

Output

Returns a storage hash value which is used to retrieve the converted files. (status: 200)
 

<a name="get-obabel"></a>
##### GET /v1/obabel/?storage_hash={storage_hash}
###### Retrieves .pdbqt files converted by openbabel

Path parameters

| Parameter | Type | Function |
|:----------|:-----|:---------|
| storage_hash | String | A hash value identifying the batch of converted .pdbqt files to retrieve|

Output

If the conversion was completed a job.zip file is returned containing one output pdbqt file per input given in the corresponding POST request (status: 200)
If job not completed, a string "Job x not completed yet." is returned (status: 203)
If the conversion was a failure a job.zip file is returned containing a text file with open babel output (status: 500)
