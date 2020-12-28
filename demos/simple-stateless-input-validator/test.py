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


example_1_valid = make_request("example_one", [{
    "object": "page",
    "entry": [{"messaging": "hello world"}]
}])
assert example_1_valid == 'received: hello world'
example_1_invalid = make_request("example_one", [{
    "object": "page",
    "entries": []
}])
assert example_1_invalid == 'error'

example_2_valid = make_request("example_two", [{
    "hub": {
        "mode": "subscribe",
        "verify_token": "AFIDOH1H41V"
    }
}])

assert example_2_valid == 'success'
example_2_invalid = make_request("example_two", [{
    "ham": {

    }
}])
assert example_2_invalid == 'error'

print("test passed")
