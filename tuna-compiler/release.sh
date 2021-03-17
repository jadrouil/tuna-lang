#!/bin/zsh
export CONDER_VERSION=0.5.2
#THIS IS THE OLD RELEASE SCRIPT AND NEEDS TO BE UPDATED.
cd conder_core/
npm run compile
cd src/main/ops/rust/
docker build -t condersystems/sps:$CONDER_VERSION . 
docker push condersystems/sps:$CONDER_VERSION
cd ../../../../
node -p "JSON.stringify({...require('./package.json'), version: '$CONDER_VERSION'}, null, 2)" > temp.json && mv temp.json package.json
cd ..
tar --exclude='**/rust/' --exclude='**/node_modules/' --exclude='conder_core/src/' --exclude='**/*.spec.*/' -czhf conder-api.tar.gz conder_core
gh release create v$CONDER_VERSION -p -t v$CONDER_VERSION 'conder-api.tar.gz#Conder API'
rm conder-api.tar.gz