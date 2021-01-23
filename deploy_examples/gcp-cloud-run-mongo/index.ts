import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { readFileSync } from "fs";
import * as ed25519 from 'noble-ed25519'
import * as mongo from '@pulumi/mongodbatlas'
import * as random from '@pulumi/random'
import { env } from "process";

// This corresponds to your GCP region. CHANGE THS AS YOU SEE FIT
// Options: https://cloud.google.com/compute/docs/regions-zones/
const location = "us-central1"
// Main.can corresponds to the output of some `tuna build` of some main.tuna. Make sure you are using the main.can of your tuna project.
// The one provided is only an example.
const can_contents = JSON.parse(readFileSync('main.can', {encoding: "utf8"}))
const can_keys = Object.keys(can_contents)
// This name doesn't really matter. It just indicates which mongo database to use.
const DEPLOYMENT_NAME = "gcp-tuna-deployment"
can_contents.DEPLOYMENT_NAME = DEPLOYMENT_NAME
const config = new pulumi.Config();
const orgId = config.requireSecret("orgId");

// This is used for generating and serializing a private key
const byteToHex: string[] = [];
for (let n = 0; n <= 0xff; ++n)
{
    const hexOctet = n.toString(16).padStart(2, "0");
    byteToHex.push(hexOctet);
}

function hex(arrayBuffer: ArrayBufferLike)
{
    const buff = new Uint8Array(arrayBuffer);
    const hexOctets = []; // new Array(buff.length) is even faster (preallocates necessary array size), then use hexOctets[i] instead of .push()

    for (let i = 0; i < buff.length; ++i)
        hexOctets.push(byteToHex[buff[i]]);

    return hexOctets.join(" ");
}
export var url: any= undefined
export var mongo_uri: pulumi.Output<string> | undefined = undefined
const private_key = ed25519.utils.randomPrivateKey()
ed25519.getPublicKey(private_key).then(public_key => {
    const envs: {name: string, value: string | pulumi.Output<string>}[] = can_keys.map(k => ({name: k, value: can_contents[k] as string}))
    envs.push(
        {name: "PUBLIC_KEY", value: hex(public_key)},
        {name: "PRIVATE_KEY", value: hex(new Uint8Array([...private_key, ...public_key]))}
    )


    // This creates a mongo project with the name my-tuna-project. You could rename it if you like.
    const project = new mongo.Project("my-tuna-project", {
        orgId
    });
    // This allows anyone to access your mongo project
    const network_access = new mongo.ProjectIpAccessList("anyone", {
        cidrBlock: "0.0.0.0/0",
        projectId: project.id
    })
    // A long hard to guess password for connecting to mongo. 
    // You can and probably should revise the length so all tuna deployments don't use 30 char passwords.
    const mongo_pass = new random.RandomPassword("mongo-pass", {
        length: 30,
        lower: true,
        upper: true,
        number: true,
        special: false,
    })

    // This creates a mongo user for your tuna deployment. Reads and writes to your application data
    // will come from this user.
    const mongo_user = new mongo.DatabaseUser("mongo-rw", {
        projectId: project.id,
        username: "tuna",
        password: mongo_pass.result,
        authDatabaseName: "admin",
        roles: [{
            databaseName: DEPLOYMENT_NAME,
            roleName: "readWrite",
        }]
    })

    // This creates a mongo database cluster.
    // Notable fields you may want to edit are region name,
    // provider name, disk size, instance size name.
    // See mongodb atlas documentation or the type info for more details.
    const db = new mongo.Cluster("tuna-state", {
        autoScalingDiskGbEnabled: false,
        clusterType: "REPLICASET",
        diskSizeGb: 10,
        mongoDbMajorVersion: "4.2",
        projectId: project.id,
        providerBackupEnabled: false,
        providerInstanceSizeName: "M10",
        //Provider Settings "block"
        providerName: "GCP",
        providerRegionName: "CENTRAL_US",
    });
    
    // This formats your mongo connection information into a single string tuna can use to connect.
    // No need to edit.
    mongo_uri = db.srvAddress.apply(t => t.trim())
    const connection_uri = mongo_uri.apply(uri => {
        const [prefix, location] = uri.split("://")
        return pulumi.interpolate`${prefix}://${mongo_user.username}:${mongo_pass.result}@${location}`
    })

    envs.push({name: "MONGO_CONNECTION_URI", value: connection_uri})
    const servlesstuna = new gcp.cloudrun.Service("tuna-deployment", {
        location,
        template: {
            spec: {
                containers: [
                    { 
                        // This is the underlying server used to run tuna code.
                        // No need to edit.
                        image: "us.gcr.io/conder-systems-281115/server:0.5.2",
                        envs
                    }
                ],
            },
        },
    })

    // Expose the serverless tuna over the internet. Now anyone on the public internet can call your tuna code.
    const iamHello = new gcp.cloudrun.IamMember("hello-everyone", {
        service: servlesstuna.name,
        location,
        role: "roles/run.invoker",
        member: "allUsers",
    });
    url = servlesstuna.statuses
})



