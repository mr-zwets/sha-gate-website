// convert integer into small endian encoded hex
export function intToHex(int,byteLength) {
  let hexBigEndian = int.toString(16);
  if (hexBigEndian.length % 2 !== 0) hexBigEndian = "0" + hexBigEndian;
  let hexSmallEndian = hexBigEndian.match(/../g).reverse().join("");
  while (hexSmallEndian.length < byteLength*2) {
    hexSmallEndian = hexSmallEndian + "00";
  }
  return hexSmallEndian;
}
