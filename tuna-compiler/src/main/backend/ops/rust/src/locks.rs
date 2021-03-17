use etcd_rs::*;
use std::convert::TryInto;
use tokio::stream::StreamExt;

pub struct Mutex {
    pub name: String
}


impl Mutex {

    fn lock_name(&self) -> String {
        format!("{}-lock", self.name)
    }

    pub async fn acquire(&self, client: & Client) -> Result<()> {
        loop {
            let next_kr = KeyRange::key(self.lock_name());
            let initalize = PutRequest::new(self.lock_name(), vec![]);
            let txn = TxnRequest::new()
            .when_version(next_kr, TxnCmp::Equal, 0)
            .and_then(PutRequest::new(self.lock_name(), "held"));
            
            let grab_open_mutex: TxnResponse = client.kv().txn(txn).await?;
            if grab_open_mutex.is_success() {
                return Ok(());
            }
        }
    }


    pub async fn release(& self, client: & Client) -> Result<()> {
        
        let release = DeleteRequest::new(KeyRange::key(self.lock_name()));
        client.kv().delete(release).await?;
        Ok(())
    }
}

