import requests
import json

url = "http://localhost:7213/"

def make_request(function_name, args):
    b = {
        "kind": "Exec",
        "data": {
            "proc": function_name,
            "arg": args
        }
    }
    payload = json.dumps(b)
    headers = {
    'Content-Type': 'application/json',
    'Content-Length': str(len(payload)),
    'Accept-Encoding': '*/*'
    }
    
    response = requests.request("PUT", url, headers=headers, data = payload)
    if response.ok:
        return response.json()
    return  'error'

userA = make_request("create_user", ["user_a", "passw0rd"])
userB = make_request("create_user", ["user_b", 'p@ssword'])
assert userB == make_request("sign_in", ["user_b", 'p@ssword'])
assert userA == make_request("sign_in", ["user_a", 'passw0rd'])
make_request("tweet", [userB, "I am user b"])
make_request('follow', [userA,'user_b' ])
assert {"user_b": ["I am user b"]} == make_request("get_tweets", [userA])
print("test passed")
