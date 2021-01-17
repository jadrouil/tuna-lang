import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { readFileSync } from "fs";
import * as ed25519 from 'noble-ed25519'
import { Output } from "@pulumi/pulumi";

const location = "us-central1"
const can_contents = JSON.parse(readFileSync('main.can', {encoding: "utf8"}))
const can_keys = Object.keys(can_contents)

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
const private_key = ed25519.utils.randomPrivateKey()
ed25519.getPublicKey(private_key).then(public_key => {
    const envs: {name: string, value: string}[] = can_keys.map(k => ({name: k, value: can_contents[k] as string}))
    envs.push(
        {name: "PUBLIC_KEY", value: hex(public_key)},
        {name: "PRIVATE_KEY", value: hex(new Uint8Array([...private_key, ...public_key]))}
    )

    const servlesstuna = new gcp.cloudrun.Service("tuna-deployment", {
        location,
        template: {
            spec: {
                containers: [
                    { 
                        image: "us.gcr.io/conder-systems-281115/server:0.5.2",
                        envs
                    }
                ],
            },
        },
    })

    // Expose the serverless tuna over the internet.
    const iamHello = new gcp.cloudrun.IamMember("hello-everyone", {
        service: servlesstuna.name,
        location,
        role: "roles/run.invoker",
        member: "allUsers",
    });

    url = servlesstuna.statuses
})



