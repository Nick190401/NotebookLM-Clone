import { withCors } from '../_shared/http.ts'
import { handleSourceImportRequest } from './handler.ts'

Deno.serve(withCors(handleSourceImportRequest))
