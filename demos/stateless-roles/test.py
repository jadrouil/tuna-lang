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

def get_admin(pwd): 
    return make_request("get_admin", [pwd])

def am_i_admin(credentials):
    return make_request("am_i_admin", [credentials])

notAdmin = get_admin("blah blah")
assert am_i_admin(notAdmin) == "error"
admin = get_admin('SOME SECRET KEY')
assert am_i_admin(admin) == 'yes'

print("test passed")
