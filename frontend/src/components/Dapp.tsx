import React from "react";
// We'll use ethers to interact with the Ethereum network and our contract
import { BigNumber, ethers } from "ethers";
// We import the contract's artifacts and address here, as we are going to be
// using them with ethers
import TokenArtifact from "../contracts/Token.json";
import OrchestratorArtifact from "../contracts/Orchestrator.json";
import FarmControllerArtifact from "../contracts/FarmControllerArtifact.json";
import contractAddress from "../contracts/contract-address.json";

import {
  Web3Context,
  ContractsContext,
  ThemeContext,
} from "../contexts/Context";

// All the logic of this dapp is contained in the Dapp component.
// These other components are just presentational ones: they don't have any
// logic. They just render HTML.
import { NoWalletDetected } from "./NoWalletDetected";
import { ConnectWallet } from "./ConnectWallet";
import { Loading } from "./Loading";
import { TransactionErrorMessage } from "./TransactionErrorMessage";
import { WaitingForTransactionMessage } from "./WaitingForTransactionMessage";
import { TabbedNav } from "./TabbedNav";
import { Footer } from "./Footer";
import { CopyToClipboard } from "./CopyToClipboard";
import { TopNav } from "./TopNav";
import { FAQ } from "./FAQ";
import { ProgressBar } from "./ProgressBar";

// This is the Hardhat Network id, you might change it in the hardhat.config.js
// Here's a list of network ids https://docs.metamask.io/guide/ethereum-provider.html#properties
// to use when deploying to other networks.
const HARDHAT_NETWORK_ID = "31337";

// This is an error code that indicates that the user canceled a transaction
const ERROR_CODE_TX_REJECTED_BY_USER = 4001;

// This component is in charge of doing these things:
//   1. It connects to the user's wallet
//   2. Initializes ethers and the Token contract
//   3. Polls the user balance to keep it updated.
//   4. Transfers tokens by sending transactions
//   5. Renders the whole application
//
// Note that (3) and (4) are specific of this sample application, but they show
// you how to keep your Dapp and contract's state in sync,  and how to send a
// transaction.

declare global {
  interface Window {
    ethereum: any;
  }
}

type TokenData = {
  name?: string;
  symbol?: string;
  decimals?: string;
};

type ErrorType = {
  data: {
    message: string;
  };
  message: string;
};

type DappState = {
  // The info of the token (i.e. It's Name and symbol)
  tokenData?: TokenData;
  // The user's address and balance
  selectedAddress?: string;
  balance?: BigNumber;
  // The ID about transactions being sent, and any possible error with them
  txBeingSent?: string;
  transactionError?: ErrorType;
  networkError?: string;
  isDarkTheme?: boolean;
  isProcessing?: boolean;
};

export class Dapp extends React.Component<{}, DappState> {
  private _provider?: ethers.providers.Web3Provider;

  private _token?: ethers.Contract;

  private _orchestrator?: ethers.Contract;

  private _farmController?: ethers.Contract;

  private _pollDataInterval?: number;

  private initialState: DappState = {
    // The info of the token (i.e. It's Name and symbol)
    tokenData: undefined,
    // The user's address and balance
    selectedAddress: undefined,
    balance: undefined,
    // The ID about transactions being sent, and any possible error with them
    txBeingSent: undefined,
    transactionError: undefined,
    networkError: undefined,
    isDarkTheme: undefined,
    isProcessing: undefined,
  };

  constructor(props: any) {
    super(props);
    this.state = this.initialState;
  }

  render() {
    // Ethereum wallets inject the window.ethereum object. If it hasn't been
    // injected, we instruct the user to install MetaMask.
    if (window.ethereum === undefined) {
      return <NoWalletDetected />;
    }

    // The next thing we need to do, is to ask the user to connect their wallet.
    // When the wallet gets connected, we are going to save the user's address
    // in the component's state. So, if it hasn't been saved yet, we have
    // to show the ConnectWallet component.
    //
    // Note that we pass it a callback that is going to be called when the user
    // clicks a button. This callback just calls the _connectWallet method.
    if (!this.state.selectedAddress) {
      return (
        <ConnectWallet
          connectWallet={() => this._connectWallet()}
          networkError={this.state.networkError}
          dismiss={() => this._dismissNetworkError()}
        />
      );
    }

    // If the token data or the user's balance hasn't loaded yet, we show
    // a loading component.
    if (!this.state.tokenData || !this.state.balance) {
      return <Loading />;
    }

    const {
      balance,
      selectedAddress,
      tokenData,
      isDarkTheme,
      isProcessing,
    } = this.state;

    const { symbol, decimals } = tokenData;

    const transferFunc = (to: string, amount: string) =>
      this._transferTokens(to, amount);

    const contractFarmController = this._farmController;

    const contractOrchestrator = this._orchestrator;

    const setIsDarkTheme = (isDark: boolean) => this._toggleTheme(isDark);

    const setIsProcessing = (isProcessing: boolean) =>
      this._setIsProcessing(isProcessing);

    // If everything is loaded, we render the application.
    return (
      <div className="container p-4">
        <div className="row">
          <div className="col-12 text-right">
            <ThemeContext.Provider
              value={{
                isDarkTheme,
                setIsDarkTheme,
              }}
            >
              <TopNav />
            </ThemeContext.Provider>
          </div>
        </div>
        <div className="row">
          <div className="col-12">
            <a
              href="/"
              rel="noopener noreferrer"
              className="d-flex align-items-center fit"
            >
              <i className="nes-octocat animate"></i>
              <h1>
                <span className="text-center text-danger ml-2">{symbol}</span>{" "}
                TOKEN
              </h1>
            </a>
          </div>
          <div className="col-12 text-center">
            <h3>⯬ {this.state.tokenData.name} ⯮</h3>
            <p className="nes-text is-disabled">
              An attempt to bring Polkadot token to the Binance Smart Chain
            </p>
            <section
              className={
                "nes-container is-rounded " + (isDarkTheme ? "is-dark" : "")
              }
            >
              <p>
                Welcome,{" "}
                <span className="break-text">{this.state.selectedAddress}</span>
                <CopyToClipboard copyText={this.state.selectedAddress} />
              </p>
              <p>
                You have{" "}
                {ethers.utils.formatUnits(
                  this.state.balance.toString(),
                  decimals,
                )}{" "}
                {symbol}
                <i className="nes-icon coin mb-2"></i>
              </p>
            </section>
          </div>
        </div>

        <div className="row mt-5">
          <div className="col-12">
            {/* 
              Sending a transaction isn't an immediate action. You have to wait
              for it to be mined.
              If we are waiting for one, we show a message here.
            */}
            {this.state.txBeingSent && (
              <WaitingForTransactionMessage txHash={this.state.txBeingSent} />
            )}

            {/* 
              Sending a transaction can fail in multiple ways. 
              If that happened, we show a message here.
            */}
            {this.state.transactionError && (
              <TransactionErrorMessage
                message={this._getRpcErrorMessage(this.state.transactionError)}
                dismiss={() => this._dismissTransactionError()}
              />
            )}
          </div>
        </div>

        <div className="row">
          <div className="col-12">
            <Web3Context.Provider
              value={{
                balance,
                selectedAddress,
                symbol,
                transferFunc,
                setIsProcessing,
              }}
            >
              <ContractsContext.Provider
                value={{
                  contractOrchestrator,
                  contractFarmController,
                }}
              >
                <ThemeContext.Provider
                  value={{
                    isDarkTheme,
                    setIsDarkTheme,
                  }}
                >
                  <TabbedNav />
                </ThemeContext.Provider>
              </ContractsContext.Provider>
            </Web3Context.Provider>
          </div>
        </div>

        <div className="row text-center" id="faq">
          <div className="col-12">
            <h4 className="text-center">Frequently Asked Questions</h4>
            <FAQ />
          </div>
        </div>

        <div className="row text-center mt-5">
          <div className="col-12">
            <section
              className={
                "nes-container is-rounded with-title is-centered " +
                (isDarkTheme ? "is-dark" : "")
              }
            >
              <p className="nes-text is-error title">Attention!</p>
              <span>
                This DApp is still under construction. Use it at your own risk.
                When in doubt, consult with{" "}
                <a
                  href="https://twitter.com/cz_binance"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  SZ
                </a>
                .
              </span>
            </section>
          </div>
        </div>

        <div className="row text-center mt-5">
          <div className="col-12">
            <Footer footerText={tokenData?.name} />
          </div>
        </div>

        <div className="row">
          <div className="col-12">
            <ProgressBar isProcessing={isProcessing} />
          </div>
        </div>
      </div>
    );
  }

  componentWillUnmount() {
    // We poll the user's balance, so we have to stop doing that when Dapp
    // gets unmounted
    this._stopPollingData();
  }

  async _connectWallet() {
    // This method is run when the user clicks the Connect. It connects the
    // dapp to the user's wallet, and initializes it.

    // To connect to the user's wallet, we have to run this method.
    // It returns a promise that will resolve to the user's address.
    const [selectedAddress] = await window.ethereum.enable();

    // Once we have the address, we can initialize the application.

    // First we check the network
    if (!this._checkNetwork()) {
      return;
    }

    this._initialize(selectedAddress);

    // We reinitialize it whenever the user changes their account.
    window.ethereum.on("accountsChanged", ([newAddress]: Array<string>) => {
      this._stopPollingData();
      // `accountsChanged` event can be triggered with an undefined newAddress.
      // This happens when the user removes the Dapp from the "Connected
      // list of sites allowed access to your addresses" (Metamask > Settings > Connections)
      // To avoid errors, we reset the dapp state
      if (newAddress === undefined) {
        return this._resetState();
      }

      this._initialize(newAddress);
    });

    // We reset the dapp state if the network is changed
    window.ethereum.on("networkChanged", ([networkId]: Array<string>) => {
      this._stopPollingData();
      this._resetState();
    });
  }

  _initialize(userAddress: string) {
    // This method initializes the dapp

    // We first store the user's address in the component's state
    this.setState({
      selectedAddress: userAddress,
    });

    // Then, we initialize ethers, fetch the token's data, and start polling
    // for the user's balance.

    // Fetching the token data and the user's balance are specific to this
    // sample project, but you can reuse the same initialization pattern.
    this._initializeEthers();
    this._getTokenData();
    this._startPollingData();
  }

  async _initializeEthers() {
    // We first initialize ethers by creating a provider using window.ethereum
    this._provider = new ethers.providers.Web3Provider(window.ethereum);

    // When, we initialize the contract using that provider and the token's
    // artifact. You can do this same thing with your contracts.
    this._token = new ethers.Contract(
      contractAddress.UFragments,
      TokenArtifact.abi,
      this._provider.getSigner(0),
    );

    this._orchestrator = new ethers.Contract(
      contractAddress.Orchestrator,
      OrchestratorArtifact.abi,
      this._provider.getSigner(0),
    );

    this._farmController = new ethers.Contract(
      contractAddress.FarmController,
      FarmControllerArtifact.abi,
      this._provider.getSigner(0),
    );
  }

  // The next to methods are needed to start and stop polling data. While
  // the data being polled here is specific to this example, you can use this
  // pattern to read any data from your contracts.
  //
  // Note that if you don't need it to update in near real time, you probably
  // don't need to poll it. If that's the case, you can just fetch it when you
  // initialize the app, as we do with the token data.
  _startPollingData() {
    this._pollDataInterval = window.setInterval(
      () => this._updateBalance(),
      1000,
    );
    // We run it once immediately so we don't have to wait for it
    this._updateBalance();
  }

  _stopPollingData() {
    window.clearInterval(this._pollDataInterval);
    this._pollDataInterval = undefined;
  }

  // The next two methods just read from the contract and store the results
  // in the component state.
  async _getTokenData() {
    if (this._token) {
      const name = await this._token.name();
      const symbol = await this._token.symbol();
      const decimals = "9"; //await this._token.decimals();
      console.log(this._token);
      this.setState({ tokenData: { name, symbol, decimals } });
    } else {
      this.setState({
        tokenData: { name: undefined, symbol: undefined, decimals: undefined },
      });
    }
  }

  async _updateBalance() {
    if (this._token) {
      const balance = await this._token.balanceOf(this.state.selectedAddress);
      this.setState({ balance });
    } else {
      this.setState({ balance: undefined });
    }
  }

  // This method sends an ethereum transaction to transfer tokens.
  // While this action is specific to this application, it illustrates how to
  // send a transaction.
  async _transferTokens(to: string, amount: string) {
    // Sending a transaction is a complex operation:
    //   - The user can reject it
    //   - It can fail before reaching the ethereum network (i.e. if the user
    //     doesn't have ETH for paying for the tx's gas)
    //   - It has to be mined, so it isn't immediately confirmed.
    //     Note that some testing networks, like Hardhat Network, do mine
    //     transactions immediately, but your dapp should be prepared for
    //     other networks.
    //   - It can fail once mined.
    //
    // This method handles all of those things, so keep reading to learn how to
    // do it.

    try {
      // If a transaction fails, we save that error in the component's state.
      // We only save one such error, so before sending a second transaction, we
      // clear it.
      this._dismissTransactionError();

      // We send the transaction, and save its hash in the Dapp's state. This
      // way we can indicate that we are waiting for it to be mined.
      if (!this._token) {
        throw new Error("Token contract not initialized");
      }
      const tx = await this._token.transfer(to, amount);
      this.setState({ txBeingSent: tx.hash });

      // We use .wait() to wait for the transaction to be mined. This method
      // returns the transaction's receipt.
      const receipt = await tx.wait();

      // The receipt, contains a status flag, which is 0 to indicate an error.
      if (receipt.status === 0) {
        // We can't know the exact error that make the transaction fail once it
        // was mined, so we throw this generic one.
        throw new Error("Transaction failed");
      }

      // If we got here, the transaction was successful, so you may want to
      // update your state. Here, we update the user's balance.
      await this._updateBalance();
    } catch (error) {
      // We check the error code to see if this error was produced because the
      // user rejected a tx. If that's the case, we do nothing.
      if (error.code === ERROR_CODE_TX_REJECTED_BY_USER) {
        return;
      }

      // Other errors are logged and stored in the Dapp's state. This is used to
      // show them to the user, and for debugging.
      console.error(error);
      this.setState({ transactionError: error });
    } finally {
      // If we leave the try/catch, we aren't sending a tx anymore, so we clear
      // this part of the state.
      this.setState({ txBeingSent: undefined });
    }
  }

  // This method just clears part of the state.
  _dismissTransactionError() {
    this.setState({ transactionError: undefined });
  }

  // This method just clears part of the state.
  _dismissNetworkError() {
    this.setState({ networkError: undefined });
  }

  // This is an utility method that turns an RPC error into a human readable
  // message.
  _getRpcErrorMessage(error: ErrorType): string {
    if (error.data) {
      return error.data.message;
    }
    return error.message;
  }

  // This method resets the state
  _resetState() {
    this.setState(this.initialState);
  }

  // This method checks if Metamask selected network is Localhost:8545
  _checkNetwork() {
    if (window.ethereum.networkVersion === HARDHAT_NETWORK_ID) {
      return true;
    }

    this.setState({
      networkError: "Please connect Metamask to Localhost:8545",
    });

    return false;
  }

  _toggleTheme(isDark: boolean) {
    this.setState({ isDarkTheme: isDark });
  }

  _setIsProcessing(isProcessing: boolean) {
    this.setState({ isProcessing });
  }
}
