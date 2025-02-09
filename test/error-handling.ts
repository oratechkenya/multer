import assert from 'assert'

import os from 'os'
import { file, submitForm } from './_util'
import multer from '../src'
import stream from 'stream'
import FormData from 'form-data'

function withLimits(limits, fields) {
  const storage = multer.memoryStorage()
  return multer({ storage: storage, limits: limits }).fields(fields)
}

describe('Error Handling', function() {
  it("should be an instance of both `Error` and `MulterError` classes in case of the Multer's error", function(done) {
    const form = new FormData()
    const storage = multer.diskStorage({ destination: os.tmpdir() })
    const upload = multer({ storage: storage }).fields([{ name: 'small0', maxCount: 1 }])

    form.append('small0', file('small0.dat'))
    form.append('small0', file('small0.dat'))

    submitForm(upload, form, function(err, req) {
      assert.equal(err instanceof Error, true)
      assert.equal(err instanceof multer.MulterError, true)
      done()
    })
  })

  it('should respect parts limit', function(done) {
    const form = new FormData()
    const parser = withLimits({ parts: 1 }, [{ name: 'small0', maxCount: 1 }])

    form.append('field0', 'BOOM!')
    form.append('small0', file('small0.dat'))

    submitForm(parser, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_PART_COUNT')
      done()
    })
  })

  it('should respect file size limit', function(done) {
    const form = new FormData()
    const parser = withLimits({ fileSize: 1500 }, [
      { name: 'tiny0', maxCount: 1 },
      { name: 'small0', maxCount: 1 },
    ])

    form.append('tiny0', file('tiny0.dat'))
    form.append('small0', file('small0.dat'))

    submitForm(parser, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_FILE_SIZE')
      assert.equal(err.field, 'small0')
      done()
    })
  })

  it('should respect file count limit', function(done) {
    const form = new FormData()
    const parser = withLimits({ files: 1 }, [
      { name: 'small0', maxCount: 1 },
      { name: 'small1', maxCount: 1 },
    ])

    form.append('small0', file('small0.dat'))
    form.append('small1', file('small1.dat'))

    submitForm(parser, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_FILE_COUNT')
      done()
    })
  })

  it('should respect file key limit', function(done) {
    const form = new FormData()
    const parser = withLimits({ fieldNameSize: 4 }, [{ name: 'small0', maxCount: 1 }])

    form.append('small0', file('small0.dat'))

    submitForm(parser, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_FIELD_KEY')
      done()
    })
  })

  it('should respect field key limit', function(done) {
    const form = new FormData()
    const parser = withLimits({ fieldNameSize: 4 }, [])

    form.append('ok', 'SMILE')
    form.append('blowup', 'BOOM!')

    submitForm(parser, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_FIELD_KEY')
      done()
    })
  })

  it('should respect field value limit', function(done) {
    const form = new FormData()
    const parser = withLimits({ fieldSize: 16 }, [])

    form.append('field0', 'This is okay')
    form.append('field1', 'This will make the parser explode')

    submitForm(parser, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_FIELD_VALUE')
      assert.equal(err.field, 'field1')
      done()
    })
  })

  it('should respect field count limit', function(done) {
    const form = new FormData()
    const parser = withLimits({ fields: 1 }, [])

    form.append('field0', 'BOOM!')
    form.append('field1', 'BOOM!')

    submitForm(parser, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_FIELD_COUNT')
      done()
    })
  })

  it('should respect fields given', function(done) {
    const form = new FormData()
    const parser = withLimits(undefined, [{ name: 'wrongname', maxCount: 1 }])

    form.append('small0', file('small0.dat'))

    submitForm(parser, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_UNEXPECTED_FILE')
      assert.equal(err.field, 'small0')
      done()
    })
  })

  it('should report errors from storage engines', function(done) {
    const storage = multer.memoryStorage()

    storage._removeFile = function _removeFile(req, _, cb) {
      const err: any = new Error('Test error')
      err.code = 'TEST'
      cb(err)
    }

    const form = new FormData()
    const upload = multer({ storage: storage })
    const parser = upload.single('tiny0')

    form.append('tiny0', file('tiny0.dat'))
    form.append('small0', file('small0.dat'))

    submitForm(parser, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_UNEXPECTED_FILE')
      assert.equal(err.field, 'small0')

      assert.equal(err.storageErrors.length, 1)
      assert.equal(err.storageErrors[0].code, 'TEST')
      assert.equal(err.storageErrors[0].field, 'tiny0')
      assert.equal(err.storageErrors[0].file, req.file)

      done()
    })
  })

  it('should report errors from busboy constructor', function(done) {
    const req = new stream.PassThrough() as stream.PassThrough & { headers: any }
    const storage = multer.memoryStorage()
    const upload: any = multer({ storage: storage }).single('tiny0')
    const body = 'test'

    req.headers = {
      'content-type': 'multipart/form-data',
      'content-length': body.length,
    }

    req.end(body)
    const request = { req }

    upload(request, null, function(err) {
      assert.equal(err.message, 'Multipart: Boundary not found')
      done()
    })
  })

  it('should report errors from busboy parsing', function(done) {
    const req = new stream.PassThrough() as stream.PassThrough & { headers: any }
    const storage = multer.memoryStorage()
    const upload: any = multer({ storage: storage }).single('tiny0')
    const boundary = 'AaB03x'
    const body = [
      '--' + boundary,
      'Content-Disposition: form-data; name="tiny0"; filename="test.txt"',
      'Content-Type: text/plain',
      '',
      'test without end boundary',
    ].join('\r\n')

    req.headers = {
      'content-type': 'multipart/form-data; boundary=' + boundary,
      'content-length': body.length,
    }

    req.end(body)

    upload({ req }, null, function(err) {
      assert.equal(err.message, 'Unexpected end of multipart data')
      done()
    })
  })

  it('should gracefully handle more than one error at a time', function(done) {
    const form = new FormData()
    const storage = multer.diskStorage({ destination: os.tmpdir() })
    const upload = multer({ storage: storage, limits: { fileSize: 1, files: 1 } }).fields([
      { name: 'small0', maxCount: 1 },
    ])

    form.append('small0', file('small0.dat'))
    form.append('small0', file('small0.dat'))

    submitForm(upload, form, function(err, req) {
      assert.equal(err.code, 'LIMIT_FILE_SIZE')
      done()
    })
  })
})
