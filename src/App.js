import './App.css';
import {useState,useEffect} from 'react'
import contractParams from './contractParams.json';
const { ElectrumClient, ElectrumTransport } = require('electrum-cash');

function App() {
  const firstStateContract = {
    state: 0,
    txid: contractParams.txid,
    address: contractParams.address,
    lastbalance: 10000000,
    votes: {
      totalVotes: 0,
      yesVotes: 0,
      noVotes: 0
    },
    votingPeriod: 100970,
    p2shpayout: "",
    lastInteraction: "initialization"
  }
  const initialVout = contractParams.initialVout;
  const [lastStateContract, setLastStateContract] = useState(firstStateContract);
  const [contractHistory, setContractHistory] = useState([firstStateContract]);
  const [blockHeight, setBlockHeight] = useState();
  const [fetchSucces, setFetchSucces] = useState(0);
  const [readLocalStorage, setReadLocalStorage] = useState(false);
  const [electrum, setElectrum] = useState();

  useEffect(() =>{
    const connect = async () => {
      const newElectrum = new ElectrumClient(
        'Electrum client example',
        '1.4.1', 'testnet4.imaginary.cash',
        ElectrumTransport.WSS.Port,
        ElectrumTransport.WSS.Scheme
      );
      await newElectrum.connect();
      setElectrum(newElectrum);
    }
    connect()
  },[])
  
  useEffect(() =>{
    const readLocalStorage = () => {
      // Convert the string back to the lastStateContract object
      const lastStateContract = JSON.parse(localStorage.getItem("lastStateContract"));
      const contractHistory = JSON.parse(localStorage.getItem("contractHistory"));
      // If the local storage is not null
      if (lastStateContract !== null && contractHistory !== null) {
        // Write the contractHistory & lastStateContract to state, dot notation for rerender
        setContractHistory([...contractHistory]);
        setLastStateContract(lastStateContract);
      }
      setReadLocalStorage(true);
    };
    readLocalStorage();
  },[])

  useEffect(() =>{
    const subscribeBlockheight = async () => {
      if(!electrum) return;
      // Set up a callback function to handle new blocks.
      const handleNewBlocks = (data) => {
        let blockheight = Array.isArray(data) ? data[0].height : data.height;
        setBlockHeight(blockheight); console.log(data)}
      // Set up a subscription for new block headers and handle events with our callback function.
      try{
        await electrum.subscribe(handleNewBlocks, 'blockchain.headers.subscribe');
        setFetchSucces(1);
      } catch(e){
        console.log(e);
        setFetchSucces(0)
      }
    }
    subscribeBlockheight();
  },[electrum])

  useEffect(() => {
    const writeToLocalStorage = () => {
      // write the lastStateContract object & contractHistory array to local storage as a string
      localStorage.setItem("lastStateContract", JSON.stringify(lastStateContract));
      localStorage.setItem("contractHistory", JSON.stringify(contractHistory));
    };
    // Write the lastStateContract to localStorage each time it changes
    writeToLocalStorage();
  }, [contractHistory,lastStateContract]);

  useEffect(() =>{
    if(!readLocalStorage)return;
    
    const checkTxsContractAddr = async () => {
      if(!electrum) return;

      // Request the full transaction history for an address.
      console.log(lastStateContract.address)
      const txHistory = await electrum.request('blockchain.address.get_history', lastStateContract.address);

      // Print out the transaction history.
      console.log(txHistory);

      for (let tx of txHistory) {
        const currentTxId = tx.tx_hash;
        if(currentTxId === lastStateContract.txid){continue}
        // Request the full transaction details for the transaction ID.
        let transactionDetails;
        try{
          transactionDetails = await electrum.request('blockchain.transaction.get', tx.tx_hash, true);
          setFetchSucces(1);
        }catch(e){
          console.log(e);
          setFetchSucces(0);
        }

        // Print out the transaction details.
        console.log(transactionDetails);

        transactionDetails.vin.forEach(async (input) => {
          let contractVout = 0;
          if(lastStateContract.state === 0) contractVout = initialVout;
          const voutInput = input.vout;
          if(input.txid === lastStateContract.txid && voutInput === contractVout){
            console.log('found tx spending the contract utxo!')
            const newBalance =  transactionDetails.vout[0].value * 100000000;
            //TODO
            const newVotes = {
              totalVotes: 0,
              yesVotes: 0,
              noVotes: 0
            };
            const newvotingPeriod = lastStateContract.votingPeriod;
            const newContractAddress = transactionDetails.vout[0].scriptPubKey.addresses[0];
            let unixTimestamp = transactionDetails.time
            if(unixTimestamp===0) unixTimestamp=Date.now();
            const txtime = new Date(unixTimestamp* 1000).toUTCString();

            const redeemScriptHex = input.scriptSig.hex;
            const p2shpayoutHex = redeemScriptHex.slice(11 * 2, 31 * 2);
            // pkhNewRecipient is 3rd argument of refresh cunction in contract, arguments are added in reverse order
            // first push 8bytes with the 8 bytes amountChange, byte bool hasChangeOutput and push 20byes pkh
            // (so 1+8+1+1) and then the actual 20 bytes of the pkhNewRecipient so starts at index 11
            const newStateContract = {
              state: lastStateContract.state+1,
              txid: currentTxId,
              address: newContractAddress,
              lastbalance: newBalance,
              votes: newVotes,
              votingPeriod: newvotingPeriod,
              p2shpayout: p2shpayoutHex,
              lastInteraction: "bridging",
              txtime
            };
            setContractHistory([newStateContract, ...contractHistory]);
            setLastStateContract(newStateContract);
          }
        })
      }
    }
    checkTxsContractAddr();
  },[readLocalStorage,electrum,lastStateContract])

  let blocksLeft =lastStateContract.votingPeriod+contractParams.period-blockHeight;
  let percentageLeft = ((1-blocksLeft/contractParams.period)*100).toFixed(1);
  const toBCH = (satAmount) =>  (satAmount/ 100000000)
  
  let startdate
  if(contractHistory.length-1>0){
    let txtimeUTC = contractHistory[contractHistory.length-2].txtime;
    startdate = txtimeUTC.substring(0, 16);
  }

  return (
    <div className="App">
      <div className="body">
      <header>
        <span className="title">Demo decentralized bridge</span>
      </header>

      <main>
      <section className="columnL">
        <h2>Details</h2>
        <p style={{overflowWrap:'anywhere',margin:"0px"}}>
          This demo is a proposal for the bridge from the Bitcoin Cash mainchain to the SBCH sidechain 
          but is a general bridging mechanism for any future sidechains.
          <br/><br/>
          It builds further on the ideas of <a href="https://docs.smartbch.org/smartbch/sha-gate" target="_blanc">first SHA-gate concept </a>
          with operators who propose withdrawal transactions and miners who vote on them but improves <a href="https://github.com/mr-zwets/upgraded-SHA-gate" target="_blanc">various shortcomings.</a>
          <br/><br/> 
          It is similar to the hashrate escrows of the <a href="https://www.drivechain.info/" target="_blanc">Drivechain </a> 
          mechanism developed for BTC but instead of needing a specific protocol upgrade,
          it utilizes BCHs general smart contract capabilities to build a sidechain covenant.
          <br/><br/>
          The demo would work today on mainnet - only the software for miner voting based on the sidechain events would have to be written.
          The security of the contract would benefit from the proposed upgrade to 32bytes P2SH addresses.
        </p>
      </section>
      <section className="columnM">
        <h2 style={{textDecoration: "underline"}}>Sidechain covenant</h2>
        <p>Live on testnet4 right now {'->'}</p>
          {!electrum? (<h2>connecting to electrum server</h2>):
          <div>
            <h2>Balance</h2>
            <div className="lastbalance">{toBCH(lastStateContract.lastbalance).toFixed(6)} tBCH</div>
            <br/>
            <h2>Voting period</h2>
            <progress value={percentageLeft} max="100" style={{width:"300px",height:"30px"}}></progress> 
            <div className="votes">{percentageLeft}% finished, {blocksLeft} blocks left</div>
            <div className="votes">{`${lastStateContract.votes.yesVotes}/${lastStateContract.votes.totalVotes}`} yes-votes</div>
            <br/>
            <h2>Payout proposal</h2>
            <div className="payoutProposal">{lastStateContract.p2shpayout}</div>
          </div>
          }
        </section> 
        <section className="columnR">
        <h2>Contract History</h2>
        <div className="divTable">
        <table style={{width:'100%'}}>
          <thead>
              <tr>
                <th>State</th>
                <th>Action</th>
                <th>Balance</th>
              </tr>
          </thead>
          <tbody>
            {contractHistory.map(({state,lastbalance,lastInteraction,address}) => 
              (<tr key={state} style={{lineHeight:'1.8'}}>
                  <td>
                  <a target='_blanc' style={{textDecoration:'none'}} href={`https://testnet4.imaginary.cash/address/${address}`}>
                    {state}
                  </a>
                </td>
                <td>
                  {lastInteraction}
                </td>
                <td>{toBCH(lastbalance)+" BCH"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <br/>
        {!electrum? 'connecting to electrum server':fetchSucces===0? 'fetching electrum server failed':null}
      </section>
      </main>
      </div>
      <footer>
      <a
            href="https://github.com/mr-zwets/upgraded-SHA-gate"
            target="_blanc" style={{textDecoration:"none",color:"black"}}
          >
          <p>
          Check contract code
        </p>
        </a>
        <a
          href="https://github.com/mr-zwets/upgraded-SHA-gate"
          target="_blanc"
        >
          <img alt="" className="githublogo" src="./github.png" />
        </a>
      </footer>
    </div>
  );
}

export default App;
