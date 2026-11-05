
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    environment {
        AWS_REGION = 'ap-south-1'
        AWS_ACCOUNT_ID = '003720988361'
        ECR_REGISTRY = '003720988361.dkr.ecr.ap-south-1.amazonaws.com'

        DEPLOY_HOST = '10.50.2.243'
        DEPLOY_USER = 'ubuntu'
        DEPLOY_DIR = '/home/ubuntu/microservices-deploy'
    }

    stages {

        stage('Checkout GitHub') {
            steps {
                checkout scm
            }
        }

        stage('Check Tools and AWS Access') {
            steps {
                sh '''
                    set -eu
                    docker --version
                    docker compose version
                    aws --version
                    aws sts get-caller-identity
                '''
            }
        }

        stage('Validate Docker Compose') {
            steps {
                sh '''
                    set -eu

                    docker compose config -q

                    POSTGRES_PASSWORD=ci-validation-placeholder IMAGE_TAG=${BUILD_NUMBER} \
                        docker compose -f deploy/docker-compose.yml config -q
                '''
            }
        }

        stage('Build Docker Images') {
            steps {
                sh '''
                    set -eu

                    for SERVICE in main-service user-service product-service cart-service order-service
                    do
                        docker build \
                            -t "${SERVICE}:${BUILD_NUMBER}" \
                            "./${SERVICE}"
                    done
                '''
            }
        }

        stage('Validate Backend Syntax') {
            steps {
                sh '''
                    set -eu
                    for SERVICE in user-service product-service order-service
                    do
                        docker run --rm --entrypoint node "${SERVICE}:${BUILD_NUMBER}" --check server.js
                    done
                '''
            }
        }

        stage('Verify Docker Images') {
            steps {
                sh '''
                    set -eu

                    for SERVICE in main-service user-service product-service cart-service order-service
                    do
                        docker image inspect \
                            "${SERVICE}:${BUILD_NUMBER}" > /dev/null
                    done
                '''
            }
        }

        stage('Login to AWS ECR') {
            steps {
                sh '''
                    set -eu

                    PASSWORD_FILE=$(mktemp)
                    trap 'rm -f "$PASSWORD_FILE"' EXIT

                    aws ecr get-login-password \
                        --region "$AWS_REGION" > "$PASSWORD_FILE"

                    docker login \
                        --username AWS \
                        --password-stdin "$ECR_REGISTRY" \
                        < "$PASSWORD_FILE"
                '''
            }
        }

        stage('Tag Docker Images') {
            steps {
                sh '''
                    set -eu

                    for SERVICE in main-service user-service product-service cart-service order-service
                    do
                        docker tag \
                            "${SERVICE}:${BUILD_NUMBER}" \
                            "${ECR_REGISTRY}/${SERVICE}:${BUILD_NUMBER}"
                    done
                '''
            }
        }

        stage('Push Images to AWS ECR') {
            steps {
                sh '''
                    set -eu

                    for SERVICE in main-service user-service product-service cart-service order-service
                    do
                        docker push \
                            "${ECR_REGISTRY}/${SERVICE}:${BUILD_NUMBER}"
                    done
                '''
            }
        }

        stage('Verify ECR Images') {
            steps {
                sh '''
                    set -eu

                    for SERVICE in main-service user-service product-service cart-service order-service
                    do
                        aws ecr describe-images \
                            --region "$AWS_REGION" \
                            --repository-name "$SERVICE" \
                            --image-ids "imageTag=${BUILD_NUMBER}" \
                            --query 'imageDetails[0].imageTags' \
                            --output text
                    done
                '''
            }
        }

        stage('Test SSH Connection') {
            steps {
                sshagent(credentials: ['docker-ec2-ssh']) {
                    sh '''
                        set -eu

                        ssh \
                            -o BatchMode=yes \
                            -o StrictHostKeyChecking=yes \
                            "${DEPLOY_USER}@${DEPLOY_HOST}" \
                            'echo "SSH connection successful"'
                    '''
                }
            }
        }

        stage('Copy Deployment Files') {
            steps {
                sshagent(credentials: ['docker-ec2-ssh']) {
                    sh '''
                        set -eu

                        ssh -o StrictHostKeyChecking=yes \
                            "${DEPLOY_USER}@${DEPLOY_HOST}" \
                            "mkdir -p '${DEPLOY_DIR}'"

                        scp -o StrictHostKeyChecking=yes \
                            deploy/docker-compose.yml \
                            deploy/nginx.conf \
                            "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_DIR}/"
                    '''
                }
            }
        }

        stage('Deploy to Docker EC2') {
            steps {
                sshagent(credentials: ['docker-ec2-ssh']) {
                    sh '''
                        set -eu

                        ssh -o StrictHostKeyChecking=yes \
                            "${DEPLOY_USER}@${DEPLOY_HOST}" \
                            "DEPLOY_DIR='${DEPLOY_DIR}' \
                             IMAGE_TAG='${BUILD_NUMBER}' \
                             ECR_REGISTRY='${ECR_REGISTRY}' \
                             AWS_REGION='${AWS_REGION}' \
                             bash -se" <<'REMOTE'
set -euo pipefail

cd "$DEPLOY_DIR"
if [ ! -f .env ] || ! grep -q '^POSTGRES_PASSWORD=.' .env; then
  echo "ERROR: Provision a secure POSTGRES_PASSWORD in $DEPLOY_DIR/.env before deploying PostgreSQL."
  exit 1
fi
echo "Database secret preflight passed."
echo "Logging into AWS ECR..."

aws ecr get-login-password --region "$AWS_REGION" |
    docker login \
        --username AWS \
        --password-stdin "$ECR_REGISTRY"

echo "Pulling Docker images..."

IMAGE_TAG="$IMAGE_TAG" docker compose pull

echo "Starting Docker containers..."

IMAGE_TAG="$IMAGE_TAG" docker compose up -d \
    --remove-orphans

echo "Reloading Nginx configuration..."
docker exec nginx-proxy nginx -t
docker exec nginx-proxy nginx -s reload

echo "Checking running containers..."

IMAGE_TAG="$IMAGE_TAG" docker compose ps

REMOTE
                    '''
                }
            }
        }

        stage('Verify Deployment') {
            steps {
                sshagent(credentials: ['docker-ec2-ssh']) {
                    sh '''
                        set -eu

                        ssh -o StrictHostKeyChecking=yes \
                            "${DEPLOY_USER}@${DEPLOY_HOST}" \
                            "DEPLOY_DIR='${DEPLOY_DIR}' \
                             IMAGE_TAG='${BUILD_NUMBER}' \
                             bash -se" <<'REMOTE'
set -euo pipefail

cd "$DEPLOY_DIR"

IMAGE_TAG="$IMAGE_TAG" docker compose ps

for ROUTE in / /users/ /products/ /cart/ /orders/
do
    echo "Testing $ROUTE"

    curl --fail --silent --show-error \
        --retry 5 \
        --retry-delay 2 \
        --retry-connrefused \
        "http://127.0.0.1${ROUTE}" > /dev/null
done

for SERVICE in products
do
    curl --fail --silent --show-error "http://127.0.0.1/api/${SERVICE}" > /dev/null
done
echo "Public products and frontend routes are responding; protected APIs require login."

REMOTE
                    '''
                }
            }
        }
    }

    post {
        success {
            echo 'SUCCESS: All 5 microservices pushed to ECR and deployed!'
        }

        failure {
            echo 'FAILED: Check Jenkins Console Output.'
        }

        always {
            echo 'Jenkins pipeline execution completed.'
        }
    }
}
