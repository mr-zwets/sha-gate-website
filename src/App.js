import './App.css';
import {useState,useEffect} from 'react'
import {intToHex} from './utils'
import contractParams from './contractParams.json';
const { ElectrumNetworkProvider, Contract } = require('cashscript');
const shaGateContract = require("./sha-gate-improved.json");
const { ElectrumClient, ElectrumTransport } = require('electrum-cash');

// Initialise cashscript network provider for testnet4
const provider = new ElectrumNetworkProvider("staging");

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
    votingPeriod: 0,
    p2shpayout: contractParams.payout,
    lastInteraction: "created sidechain covenant"
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
        if(contractHistory[contractHistory.length-1].address!==contractParams.address){
          localStorage.clear()
          setReadLocalStorage(true);
          return
        }
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
            let newvotingPeriod = lastStateContract.votingPeriod;
            const newContractAddress = transactionDetails.vout[0].scriptPubKey.addresses[0];
            let unixTimestamp = transactionDetails.time
            if(unixTimestamp===0) unixTimestamp=Date.now();
            const txtime = new Date(unixTimestamp* 1000).toUTCString();
            
            let totalVotes = lastStateContract.votes.totalVotes
            let yesVotes = lastStateContract.votes.yesVotes
            let noVotes = lastStateContract.votes.noVotes
            let p2shpayoutHex = lastStateContract.p2shpayout
            let startPeriodBytes = intToHex(lastStateContract.votingPeriod,8)
            let lastInteraction = `bridged ${+toBCH(newBalance-lastStateContract.lastbalance).toFixed(6)} tBCH`
            if(lastStateContract.address!==newContractAddress){
              // standard contract params without votecount
              const params= [
                contractParams.pkhOperator0,
                contractParams.pkhOperator1,
                contractParams.pkhOperator2,
                contractParams.pkhOperator3,
                contractParams.pkhOperator4,
                startPeriodBytes,
                p2shpayoutHex
              ];
              // make contract for yes and no vote
              const prevVoteCount = lastStateContract.votes.totalVotes;
              let voteCountBytesAfterYes = intToHex(prevVoteCount+1,2);
              let voteCountBytesAfterNo = intToHex(prevVoteCount-2,2);
              const yesParams = [...params,voteCountBytesAfterYes];
              console.log(yesParams)
              const noParams = [...params,voteCountBytesAfterNo];;
              const newContractAfterYes = new Contract(shaGateContract, yesParams, provider);
              const newContractAfterNo = new Contract(shaGateContract, noParams, provider);
              if(newContractAddress===newContractAfterYes.address || newContractAddress===newContractAfterNo.address){
                newContractAddress===newContractAfterYes.address? yesVotes += 1:noVotes += 1
                lastInteraction = newContractAddress===newContractAfterYes.address? "miner added yes-vote":"miner added no-vote"
                totalVotes= yesVotes - 2*noVotes
              } else {
                lastInteraction = "initialized withdrawal";
                const redeemScriptHex = input.scriptSig.hex;
                console.log(redeemScriptHex)
                p2shpayoutHex = redeemScriptHex.slice(2,64)
                // normally transactionDetails.locktime but for demo tx height
                newvotingPeriod = 102366
              }
            }

            const newVotes = {
              totalVotes,
              yesVotes,
              noVotes
            };
            const newStateContract = {
              state: lastStateContract.state+1,
              txid: currentTxId,
              address: newContractAddress,
              lastbalance: newBalance,
              votes: newVotes,
              votingPeriod: newvotingPeriod,
              p2shpayout: p2shpayoutHex,
              lastInteraction,
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
  let voteCount = lastStateContract.votes.yesVotes+lastStateContract.votes.noVotes
  let yesPercentage = voteCount? lastStateContract.votes.yesVotes/voteCount : 1;
  const toBCH = (satAmount) =>  (satAmount/ 100000000)
  let withrawalInitialized = lastStateContract.p2shpayout!=='0'.repeat(62)
  
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
            <div> Sidechain contract holds</div>
            <div className="lastbalance">{+toBCH(lastStateContract.lastbalance).toFixed(6)} tBCH</div>
            <br/>
            <h2>Voting period</h2>
            {withrawalInitialized?
            <><div className="votes">{percentageLeft}% finished, {blocksLeft} blocks left</div>
              <progress value={percentageLeft} max="100" style={{width:"300px",height:"30px"}}></progress> 
              <div className="votes">{`${yesPercentage*100}% yes-votes (${lastStateContract.votes.yesVotes}/${voteCount})`}</div>
              <div className="status">Current status: {lastStateContract.votes.totalVotes>=0?"approved":"rejected"}</div>
            </> : <>
              <div>The voting period has not started.</div>
              <div>A new withdrawal proposal has to be initialized first.</div>
              <br/>
            </>
            }
            
            <br/>
            <h2>Withdrawal proposal</h2>
            {withrawalInitialized?
            (<>
              <div>Contract hash:</div>
              <div>{lastStateContract.p2shpayout.slice(0,46)}</div>
              <br/>
              <div>Amount: {toBCH(parseInt('0x'+lastStateContract.p2shpayout.slice(46).match(/../g).reverse().join(''))).toFixed(6)} tBCH</div>
            </>):
            (<>
              <div>Open for a new proposal to be initialized.</div>
              <div>Initializing means one of the 5 operators proposes a withrawal transaction from the sidechain for the miners to vote on.</div>
            </>)}
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
              </tr>
          </thead>
          <tbody>
            {contractHistory.map(({state,lastInteraction,address}) => 
              (<tr key={state} style={{lineHeight:'1.8'}}>
                  <td>
                  <a target='_blanc' style={{textDecoration:'none'}} href={`https://testnet4.imaginary.cash/address/${address}`}>
                    {state}
                  </a>
                </td>
                <td>
                  {lastInteraction}
                </td>
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
          Check the contract repo
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
