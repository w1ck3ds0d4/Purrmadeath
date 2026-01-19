// Fast deterministic random in [0, 1] from integer coordinates + salt.
export function rand2D(x, y, salt = 0) {
    let n = Math.imul(x ^ (salt * 374761393), 668265263) ^ Math.imul(y ^ (salt * 1274126177), 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
