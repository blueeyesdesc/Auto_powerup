const { Api, JsonRpc, RpcError } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const fetch = require('node-fetch');
const { TextEncoder, TextDecoder } = require('util');

const privateKey = process.env.EOS_PRIVATE_KEY;
const payerAccount = "EOS_account";                      //Transaction payer
const receiverAccount = "EOSaccount";                    //ressources receiver

const signatureProvider = new JsSignatureProvider([privateKey]);
const rpc = new JsonRpc('https://vaulta.greymass.com', { fetch }); 
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

async function getPowerupState() {
  try {
    const powerStateTable = await rpc.get_table_rows({
      code: "eosio", 
      table: "powup.state",
      scope: "",
      limit: 1,
      reverse: false,
      show_payer: false
    });
    
    if (powerStateTable.rows.length === 0) {
      throw new Error("Power state table is empty");
    }
    
    return powerStateTable.rows[0];
  } catch (err) {
    console.error("❌ Failed to fetch power state:", err);
    throw err;
  }
}

function calculateMaxFractions(powerState, maxPaymentEos, cpuRatio = 0.99, netRatio = 0.01) {
  const maxPayment = parseFloat(maxPaymentEos.replace(' EOS', ''));

  const netUtilization = parseFloat(powerState.net.adjusted_utilization) / 1e16;
  const cpuUtilization = parseFloat(powerState.cpu.adjusted_utilization) / 1e16;

  const netMinPrice = parseFloat(powerState.net.min_price.replace(' EOS', '')); 
  const netMaxPrice = parseFloat(powerState.net.max_price.replace(' EOS', '')); 
  const cpuMinPrice = parseFloat(powerState.cpu.min_price.replace(' EOS', '')); 
  const cpuMaxPrice = parseFloat(powerState.cpu.max_price.replace(' EOS', ''));

  const currentNetPrice = netMinPrice + (netMaxPrice - netMinPrice) * Math.pow(netUtilization, 2);
  const currentCpuPrice = cpuMinPrice + (cpuMaxPrice - cpuMinPrice) * Math.pow(cpuUtilization, 2);

  const days = 1;
  const totalBudget = maxPayment;
  const netBudget = totalBudget * netRatio;
  const cpuBudget = totalBudget * cpuRatio;

  const netFrac = Math.floor((netBudget / (currentNetPrice * days)) * 1e16);
  const cpuFrac = Math.floor((cpuBudget / (currentCpuPrice * days)) * 1e16);

  const actualNetCost = (netFrac / 1e16) * currentNetPrice * days;
  const actualCpuCost = (cpuFrac / 1e16) * currentCpuPrice * days;
  const actualTotalCost = actualNetCost + actualCpuCost;

  return {
    net_frac: netFrac.toString(),
    cpu_frac: cpuFrac.toString(),
    max_payment: maxPaymentEos,
    actual_cost: actualTotalCost.toFixed(4) + " EOS" 
  };
}

async function executePowerup() {
  try {
    const powerState = await getPowerupState();
    
    const maxPayment = "0.1000 EOS";
    
    const powerupData = calculateMaxFractions(powerState, maxPayment);
    

    const result = await api.transact({
      actions: [{
        account: 'eosio',
        name: 'powerup',
        authorization: [{
          actor: payerAccount,
          permission: 'active',
        }],
        data: {
          payer: payerAccount,
          receiver: receiverAccount,
          days: 1,
          net_frac: powerupData.net_frac,
          cpu_frac: powerupData.cpu_frac,
          max_payment: powerupData.max_payment,
        },
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 120,
    });

    console.log("Explorer:", `https://coffe.bloks.io/transaction/${result.transaction_id}`);

  } catch (error) {
    console.error("❌ EOS Powerup failed!");
    if (error.json) {
      console.error(JSON.stringify(error.json, null, 2));
    } else {
      console.error(error);
    }
  }
}

// Run
executePowerup();