import { createClient } from "tinacms/dist/client";
import { queries } from "./types";
export const client = createClient({ url: '/api/tina/backend', token: 'null', queries,  });
export default client;
  