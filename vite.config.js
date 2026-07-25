import {
  defineConfig
} from "vite";


export default defineConfig({

  /*
   * Relative asset URLs work at:
   *
   * localhost
   * GitHub project pages
   * custom domains
   * Node production hosting
   */

  base:
    "./",


  server: {

    port:
      5173,

    strictPort:
      true,

    host:
      "0.0.0.0",

    proxy: {

      "/api": {

        target:
          "http://localhost:8787",

        changeOrigin:
          true

      }

    }

  },


  build: {

    outDir:
      "dist",

    emptyOutDir:
      true

  }

});