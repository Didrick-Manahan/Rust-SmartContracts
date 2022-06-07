/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import fs from 'mz/fs';
import path from 'path';
import * as borsh from 'borsh';

import {getPayer, getRpcUrl, createKeypairFromFile} from './utils';

/**
 * Connection to the network
 */
let connection: Connection;

/**
 * Keypair associated to the fees' payer
 */
let payer: Keypair;

/**
 * Hello world's program id
 */
let programId: PublicKey;

/**
 * The public key of the account we are saying hello to
 */
let greetedPubkey: PublicKey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, '../../dist/program');

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const PROGRAM_SO_PATH = path.join(PROGRAM_PATH, 'helloworld.so');

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy dist/program/helloworld.so`
 */
const PROGRAM_KEYPAIR_PATH = path.join(PROGRAM_PATH, 'helloworld-keypair.json');

/**
 * The state of a greeting account managed by the hello world program
 */

 //this class type in Typescript is analgous to the struct type (GreetingAccount) on the Rust side
class GreetingAccount {
  //txt: string = ''; --> David Choi
  counter = 0; //all variables need to follow constructor below
  //fields: {txt: string} --> David Choi
  constructor(fields: {counter: number} | undefined = undefined) { //Borsch library requires this as metadata
    if (fields) {
      this.counter = fields.counter; //variables set in here (inside this scope)
      //this.txt = fields.txt: --> David Choi
    }
  }
}

//everything is statically typed!

/**
 * Borsh schema definition for greeting accounts
 */
const GreetingSchema = new Map([ //Borsch requires additional metadata to do a mapping
  //Borsch needs type that is coming from client side
  //and needs mapping information of how it maps to program side (Rust code)
  [GreetingAccount, {kind: 'struct', fields: [['counter', 'u32']]}], //similar to Rust code
  //[GreetingAccount, {kind: 'struct', fields: [['txt', 'String']]}] --> David Choi
]);

/**
 * The expected size of each greeting account.
 */
 //serializes into bytes
const GREETING_SIZE = borsh.serialize( //needed for sizing actual data size of greeting account (and rentExemption)
  GreetingSchema,
  new GreetingAccount(),
).length;

/**
 * Establish a connection to the cluster
 */
export async function establishConnection(): Promise<void> {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, 'confirmed');
  const version = await connection.getVersion();
  console.log('Connection to cluster established:', rpcUrl, version);
}

/**
 * Establish an account to pay for everything (also calculate fees for transcations)
 */
export async function establishPayer(): Promise<void> {
  let fees = 0;
  if (!payer) {

    //System Program/runtime provides this call to obtain helper object to make calculations
    const {feeCalculator} = await connection.getRecentBlockhash();

    // Calculate the cost to fund the greeter account
    fees += await connection.getMinimumBalanceForRentExemption(GREETING_SIZE); //GREETING_SIZE is size of account's data

    // Calculate the cost of sending transactions
    fees += feeCalculator.lamportsPerSignature * 100; // wag
    //100 is for test environment? Extra buffer of lamports so we don't have to restock/airdrop more lamports

    payer = await getPayer();
    //doesn't have newAccountWithLamports like in David Choi tutorial

  }

  //check that we have enough Lamports
  let lamports = await connection.getBalance(payer.publicKey);
  if (lamports < fees) {
    // If current balance is not enough to pay for fees, request an airdrop
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      fees - lamports,
    );
    await connection.confirmTransaction(sig);
    lamports = await connection.getBalance(payer.publicKey);
  }

  console.log(
    'Using account',
    payer.publicKey.toBase58(),
    'containing',
    lamports / LAMPORTS_PER_SOL,
    'SOL to pay for fees',
  );
}

/**
 * Check if the hello world BPF program has been deployed
 */
export async function checkProgram(): Promise<void> {
  // Read program id from keypair file
  try {
    const programKeypair = await createKeypairFromFile(PROGRAM_KEYPAIR_PATH);
    programId = programKeypair.publicKey; //public address
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read program keypair at '${PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}. Program may need to be deployed with \`solana program deploy dist/program/helloworld.so\``,
    );
  }

  // Check if the program has been deployed
  //real Account objects are called AccountInfo
  const programInfo = await connection.getAccountInfo(programId); //actual account living inside blockchain
  if (programInfo === null) {
    if (fs.existsSync(PROGRAM_SO_PATH)) {
      throw new Error(
        'Program needs to be deployed with `solana program deploy dist/program/helloworld.so`',
      );
    } else {
      throw new Error('Program needs to be built and deployed');
    }
  } else if (!programInfo.executable) {
    throw new Error(`Program is not executable`);
  }
  console.log(`Using program ${programId.toBase58()}`); //program ID in string format

  // Derive the address (public key) of a greeting account from the program so that it's easy to find later.
  const GREETING_SEED = 'hello';
  greetedPubkey = await PublicKey.createWithSeed(
    payer.publicKey,
    GREETING_SEED,
    programId, //owner of the account
  );

  // Check if the greeting account has already been created
  const greetedAccount = await connection.getAccountInfo(greetedPubkey);
  if (greetedAccount === null) { //this code run over and over again, we need check if accounts already exist or not
    console.log(
      'Creating account',
      greetedPubkey.toBase58(),
      'to say hello to',
    );

    //greetingAccount is the account that is written to by the program (we dont want constant pay rent)
    const lamports = await connection.getMinimumBalanceForRentExemption(
      GREETING_SIZE,
    );


    //account doesn't exist, try to create new account
    //create our first transcation
    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({ //system program can create accounts for us! (here we use seed value to create account)
        fromPubkey: payer.publicKey, //Payer for this transaction
        basePubkey: payer.publicKey,
        seed: GREETING_SEED,
        newAccountPubkey: greetedPubkey, //keypair that we would like to be used
        lamports,                        // base amount of lamports that we want this account to have (for rent exemption)
        space: GREETING_SIZE,            // size of data we are requesting on this account (this technically can be updated, but NOT RECOMMNEDED)
        programId,                       // programID that will own (control, access, update) this account
      }),
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
  }
}

/**
 * Say hello
 */
 //sayHello(msg: string) --> David Choi code
export async function sayHello(): Promise<void> {
  console.log('Saying hello to', greetedPubkey.toBase58()); //affected account
  //let messageAccount = new GreetingAccount();
  //messageAccount.txt = msg;
  const instruction = new TransactionInstruction({
    keys: [{pubkey: greetedPubkey, isSigner: false, isWritable: true}],
    programId,
    data: Buffer.alloc(0), // All instructions are hellos (any data that is sent over)
    //data: Buffer.from(borsh.serialize(GreetingSchema, messageAccount)) --> David Choi
    //above serialization in necessary because we need metadata to be in correct form
    //also wrap in node Buffer so it can go in as a block!
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer], //payerAccount
  );
}

/**
 * Report the number of times the greeted account has been said hello to
 */

 //retrieve data from that account off of the network
export async function reportGreetings(): Promise<void> {
  //console.log('Retrieving message from greeting account')
  const accountInfo = await connection.getAccountInfo(greetedPubkey); //get greeted account (grab AccountInfo object back)
  if (accountInfo === null) {
    throw 'Error: cannot find the greeted account';
  }
  //convert to object that Javascript can understand (const greeting: Greeting Account - David Choi code)
  const greeting = borsh.deserialize( //some deserializations (decode)
    GreetingSchema,
    GreetingAccount, //Account type on this client side is of type GreetingAccount
    accountInfo.data,
  );
  console.log( //since we now have GreetingAccount object instance, we can have statically typed members!
    //'Account'
    greetedPubkey.toBase58(),
    'has been greeted',
    greeting.counter, //display counter value
    //greeting.txt --> David Choi
    'time(s)',
  );
}
