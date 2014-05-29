#!/bin/bash -e

for i in "$@"
do
case $i in
  --role=*) role="${i#--role=}" ;;
  --mount=*) mount="${i#--mount=}" ;;
  --bucket=*) bucket="${i#--bucket=}" ;;
  --shell) shell=1 ;;
  -h|--help)
    cat <<EOF

  Usage: beaker [options]
  Options:
          -h  --help      Display this message
              --mount     Mount S3 bucket
              --shell     Start bash instead of launching beaker.

EOF
    exit
    ;;
esac
done

cd /home/beaker

if [[ ! -z $bucket ]] && [[ ! -z $mount ]]; then
  # Make fuse device node if it doesn't exist. This line requires --priviliged.
  [[ -c /dev/fuse ]] || mknod -m 666 /dev/fuse c 10 229

  # Create mount point if it doesn't exist.
  [[ -f "$mount" ]] || mkdir -p "$mount"

  # Use an IAM role if provided, otherwise get credentials from the environment.
  if [[ ! -z $role ]]; then
    opts="-o iam_role=$role"
  fi

  /usr/local/bin/s3fs $opts "$bucket" "$mount"

  unset AWSACCESSKEID AWSSECRETACCESSKEY
fi

if [[ $shell -eq 1 ]]; then
    exec /bin/bash
else
    exec su -m beaker -c "gradle --project-dir /home/beaker/core/config/builds/dev/ run"
fi
