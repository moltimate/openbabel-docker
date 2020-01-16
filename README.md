# openbabel-docker
The components necessary to build a docker container running an instance of 
openbabel with its own HTTP API.

### Contents

* [Setup & Run](#setup-run)
* [API Summary](#api-summary)
* [API Details](#api-details)


<a name="setup-run"></a>
### Setup & Run

#### Docker Toolbox

First, build a docker image from the root directory of the openbabel-docker
source code.

   ```docker image build -t [name for the docker image] [location of the openbabel-docker directory]```

After the image has been generated, create a container. This container should
have port 8000 exposed.

    ```docker run -p [external port to be hit]:8000 [name of the docker image]```
    
Users can now interact with the instance of Open Babel in the docker container. The following output should appear:

    ```
    > autodock@0.0.1 start /opt/obabel
    > node index.js

    Listening on port 8000.
    ```
    
To interact with the API for the container, find the ip address of the docker host machine with the following command:

    ```docker-machine ip```
    
The displayed IP will be the address to send http requests to, along with the external port chosen when creating the container.

<a name="api-summary"></a>
### API Summary

This briefly summarizes all API endpoints.

| HTTP Method | Endpoint | Function |
|:------------|:---------|:---------|
| POST | [/v1/obabel](#post-obabel) | Submits .pdb files for conversion to pdbqt file format |
| GET | [/v1/obabel/{storage_hash}](#get-obabel) | Returns a zip file of pdbqt files that were previously submitted as .pdb files |


<a name="api-details"></a>
### API Details

This outlines the API's endpoints, request types, and expected request parameters or JSON payload.

<a name="post-obabel"></a>
##### POST /v1/obabel
###### Submits a number of .pdb files to Open Babel for conversion

Request body parameters

| Parameter | Type | Function |
|:----------|:-----|:---------|
| molecule_n | form data | A .pdb file to be converted to .pdbqt format. Note that any number of molecules can be given, keyed "molecule_1," "molecule_2," etc.|

Output

Returns a storage hash value which is used to retrieve the converted files. (status: 200)
) 

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
