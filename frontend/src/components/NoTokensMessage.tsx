type Props = {
  selectedAddress?: string;
};

export function NoTokensMessage({ selectedAddress }: Props) {
  return (
    <>
      <p>You don't have tokens to transfer</p>
      <p>
        To get some tokens, open a terminal in the root of the repository and
        run:
        <br />
        <br />
        <code>npx hardhat --network localhost faucet {selectedAddress}</code>
      </p>
    </>
  );
}
