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
    return response.json()

def create_user(name): 
    return make_request("create_user", [name])

def delete_user(credentials):
    return make_request("delete_user", [credentials])

userA = create_user("a")
assert create_user("a") == "user already exists"
userB = create_user("b")
delete_user(userA)
assert create_user("a") != "user already exists"

print("test passed")
