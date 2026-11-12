// ts-base 1.0.0: key properties of the released files (see ts-profile-suite.mjs).
import { suite } from './ts-profile-suite.mjs';

await suite('ts-base', {
  extraPins: [],
  tsconfigs: ['tsconfig.json'],
  forbidden: ['eslint-plugin-react', 'vue-eslint-parser'],
});
