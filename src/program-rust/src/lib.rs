use borsh::{BorshDeserialize, BorshSerialize}; //importing libraries
use solana_program::{
    //below is just an indicator of all libraries we need access to in order to make
    //our calls into the Solana runtime
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Define the type of state stored in accounts
#[derive(BorshSerialize, BorshDeserialize, Debug)] //type of macro in the form of an annotation (similar to Javascript annotation)
pub struct GreetingAccount {
    /// number of greetings
    pub counter: u32, //not holding any real worth while data right now
    //pub txt: String --> David Choi
}

// Declare and export the program's entrypoint
entrypoint!(process_instruction);

// Program entrypoint's implementation
pub fn process_instruction(
    //we will have mirror of these three parameters in client side Javascript code
    program_id: &Pubkey, // Public key of the account the hello world program was loaded into
    accounts: &[AccountInfo], // The account to say hello to (array of accounts that our specific program claims to need access to)
    _instruction_data: &[u8], //Byte array data that acts as parameters for our program to make decisions on // Ignored, all helloworld instructions are hellos
) -> ProgramResult {
    //below is the call to do logging (solana logs -u localhost)
    msg!("Hello World Rust program entrypoint"); //msg! instead of printl (not performant)

    // Iterating accounts is safer than indexing
    let accounts_iter = &mut accounts.iter();

    // Get the account to say hello to
    let account = next_account_info(accounts_iter)?; //helper function to grab next account

    // The account must be owned by the program in order to modify its data
    //owner doesn't mean user with private key, it means programmatic controller of the account
    if account.owner != program_id {
        msg!("Greeted account does not have the correct program id");
        return Err(ProgramError::IncorrectProgramId);
    }

    // Increment and store the number of times the account has been greeted

    //we can put any type of data we want as long as we encode and decode it properly
    let mut greeting_account = GreetingAccount::try_from_slice(&account.data.borrow())?; //decode data into actual type instance
    greeting_account.counter += 1; //increments counter (useless, but shows mechanics)
    greeting_account.serialize(&mut &mut account.data.borrow_mut()[..])?; //encoding back into data

    msg!("Greeted {} time(s)!", greeting_account.counter); //close off by logging we are done!

    Ok(())
}

// Sanity tests
#[cfg(test)]
mod test {
    use super::*;
    use solana_program::clock::Epoch;
    use std::mem;

    #[test]
    fn test_sanity() {
        let program_id = Pubkey::default();
        let key = Pubkey::default();
        let mut lamports = 0;
        let mut data = vec![0; mem::size_of::<u32>()];
        let owner = Pubkey::default();
        let account = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            Epoch::default(),
        );
        let instruction_data: Vec<u8> = Vec::new();

        let accounts = vec![account];

        assert_eq!(
            GreetingAccount::try_from_slice(&accounts[0].data.borrow())
                .unwrap()
                .counter,
            0
        );
        process_instruction(&program_id, &accounts, &instruction_data).unwrap();
        assert_eq!(
            GreetingAccount::try_from_slice(&accounts[0].data.borrow())
                .unwrap()
                .counter,
            1
        );
        process_instruction(&program_id, &accounts, &instruction_data).unwrap();
        assert_eq!(
            GreetingAccount::try_from_slice(&accounts[0].data.borrow())
                .unwrap()
                .counter,
            2
        );
    }
}
