import requests

url = "http://localhost:7213/"

def make_request(payload):
    headers = {
    'Content-Type': 'application/json',
    'Content-Length': str(len(payload)),
    'Accept-Encoding': '*/*'
    }

    response = requests.request("PUT", url, headers=headers, data = payload)
    return response.json()

def get_user():
    return make_request("{\"kind\": \"Exec\", \"data\": {\"proc\": \"get_user\", \"arg\": [\"someUser\"]}}")

def make_user():
    return make_request( "{\"kind\": \"Exec\", \"data\": {\"proc\": \"create_user\", \"arg\": [\"someUser\"]}}")

def make_group():
    return make_request( "{\"kind\": \"Exec\", \"data\": {\"proc\": \"create_chat_group\", \"arg\": [\"talk2self\", [\"someUser\"]]}}")

def send_message():
    return make_request( "{\"kind\": \"Exec\", \"data\": {\"proc\": \"send_message\", \"arg\": [{\"from\": \"someUser\", \"body\": \"Hi self\"}, \"talk2self\"]}}")
def get_messages():
    return make_request( "{\"kind\": \"Exec\", \"data\": {\"proc\": \"get_my_messages\", \"arg\": [\"someUser\"]}}")

assert get_user() == {'isNone': True, 'val': None}
assert make_user() == "user created"
assert make_user() == "user already exists"
assert send_message() == "group does not exist"
assert make_group() == "created"
assert make_group() == "group already exists"
assert send_message() == None
assert get_messages() == {"talk2self": [{"from": "someUser", "body": "Hi self"}]}

