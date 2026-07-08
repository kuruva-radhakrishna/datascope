'use strict';

const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/stats.js');

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ~${expected} (tol ${tol})`);
}

test('log-gamma against known values', () => {
  close(S.logGamma(1), 0, 1e-10, 'lgamma(1)');
  close(S.logGamma(5), Math.log(24), 1e-10, 'lgamma(5) = log(4!)');
  close(S.logGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10, 'lgamma(0.5)');
});

test('incomplete beta basics', () => {
  close(S.ibeta(0.5, 1, 1), 0.5, 1e-12, 'I_0.5(1,1) uniform');
  close(S.ibeta(0.3, 2, 2), 0.3 * 0.3 * (3 - 2 * 0.3), 1e-10, 'I_x(2,2) closed form');
});

test('t-distribution two-tailed p — canonical value', () => {
  // t = 2.0, df = 10 => two-tailed p ≈ 0.07339
  close(S.tTwoTailedP(2.0, 10), 0.0734, 5e-4, 't=2 df=10');
  // t = 0 => p = 1
  close(S.tTwoTailedP(0, 10), 1, 1e-12, 't=0');
});

test('chi-square upper tail — canonical values', () => {
  close(S.chiSquareP(3.841, 1), 0.05, 5e-4, 'chi2=3.841 df=1');
  close(S.chiSquareP(5.991, 2), 0.05, 5e-4, 'chi2=5.991 df=2');
});

test('F distribution consistent with t^2', () => {
  // F(1, df) with F = t^2 equals two-tailed t p-value
  close(S.fDistP(4.0, 1, 10), S.tTwoTailedP(2.0, 10), 1e-9, 'F=t^2 equivalence');
});

test('Welch t-test on hand-computed sample', () => {
  const a = [20, 22, 19, 20, 21, 20];
  const b = [28, 30, 27, 29, 30, 28];
  const r = S.welchTTest(a, b);
  assert.ok(r.p < 1e-5, `clearly different groups should give tiny p, got ${r.p}`);
  assert.ok(r.t < 0, 'mean(a) < mean(b) => negative t');
  const same = S.welchTTest([5, 6, 5, 6, 5, 6], [5, 6, 5, 6, 6, 5]);
  assert.ok(same.p > 0.5, `near-identical groups should give large p, got ${same.p}`);
});

test('chi-square independence on a planted association', () => {
  // courier A: 90 kept / 10 returned; courier B: 60 kept / 40 returned
  const couriers = [], returned = [];
  for (let i = 0; i < 90; i++) { couriers.push('A'); returned.push('no'); }
  for (let i = 0; i < 10; i++) { couriers.push('A'); returned.push('yes'); }
  for (let i = 0; i < 60; i++) { couriers.push('B'); returned.push('no'); }
  for (let i = 0; i < 40; i++) { couriers.push('B'); returned.push('yes'); }
  const r = S.chiSquareIndependence(couriers, returned);
  // hand-computed: chi2 = 200*(90*40-10*60)^2 / (100*100*150*50) = 24
  close(r.chi2, 24, 1e-9, 'chi2 statistic');
  assert.strictEqual(r.df, 1);
  assert.ok(r.p < 1e-5, `p should be tiny, got ${r.p}`);
});

test('ANOVA detects group differences', () => {
  const r = S.oneWayANOVA({
    g1: [1, 2, 1, 2, 1],
    g2: [5, 6, 5, 6, 5],
    g3: [9, 10, 9, 10, 9],
  });
  assert.ok(r.p < 1e-8, `distinct groups => tiny p, got ${r.p}`);
  assert.strictEqual(r.df1, 2);
  assert.strictEqual(r.df2, 12);
});

test('correlation significance', () => {
  // r = 0.5, n = 20 => t = 0.5*sqrt(18/0.75) ≈ 2.449, p ≈ 0.0249
  const xs = [], ys = [];
  // construct data with known-ish correlation via formula check instead:
  const r = 0.5, n = 20;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  close(S.tTwoTailedP(t, n - 2), 0.0249, 5e-4, 'r=0.5 n=20 p-value');
  // perfectly correlated data
  for (let i = 0; i < 10; i++) { xs.push(i); ys.push(2 * i + 1); }
  const perfect = S.correlationTest(xs, ys);
  close(perfect.r, 1, 1e-12, 'perfect correlation r');
  assert.ok(perfect.p < 1e-10, 'perfect correlation p ~ 0');
});
