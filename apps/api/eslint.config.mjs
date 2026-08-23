import { createNestConfig } from '@hktutor/eslint-config/nest';

export default createNestConfig({
  tsconfigRootDir: import.meta.dirname,
});
