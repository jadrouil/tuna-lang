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

def fib(left, right, depth):
    if depth == 0:
        return right
    return fib(right, left + right, depth - 1)

def remote_fib():
    return make_request("{\"kind\": \"Exec\", \"data\": {\"proc\": \"try_fib\", \"arg\": [4]}}")

print(fib(1, 1, 4))
print(remote_fib())
assert remote_fib() == fib(1, 1, 4)


